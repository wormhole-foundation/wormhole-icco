use cosmwasm_std::{
    to_binary, Addr, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, MessageInfo, QuerierWrapper,
    QueryRequest, Response, StdError, StdResult, Uint128, Uint256, WasmMsg, WasmQuery,
};
use cw20::{Cw20ExecuteMsg, Cw20QueryMsg, TokenInfoResponse};
use serde::de::DeserializeOwned;
use terraswap::{
    asset::{Asset, AssetInfo},
    querier::{query_balance, query_token_balance},
};

use token_bridge_terra::msg::{
    ExecuteMsg as TokenBridgeExecuteMsg, QueryMsg as TokenBridgeQueryMsg, WrappedRegistryResponse,
};
use wormhole::{
    msg::{ExecuteMsg as WormholeExecuteMsg, QueryMsg as WormholeQueryMsg},
    state::ParsedVAA,
};

use icco::{
    common::{
        make_asset_info, to_uint128, AssetAllocation, ContributionsSealed, SaleAborted, SaleInit,
        SaleSealed, SaleStatus, CHAIN_ID,
    },
    error::CommonError,
};

use crate::{
    error::ContributorError,
    msg::ExecuteMsg,
    state::{
        sale_asset_indices, throw_if_active, throw_if_inactive, update_buyer_contribution,
        BuyerStatus, PendingContributeToken, TokenIndexKey, ACCEPTED_ASSETS, ASSET_INDICES, CONFIG,
        PENDING_CONTRIBUTE_TOKEN, SALES, SALE_STATUSES, SALE_TIMES, TOTAL_ALLOCATIONS,
        TOTAL_CONTRIBUTIONS,
    },
};

// nonce means nothing?
const WORMHOLE_NONCE: u32 = 0;

pub fn init_sale(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    signed_vaa: Binary,
) -> StdResult<Response> {
    let payload = parse_and_verify_vaa(deps.as_ref(), &env, signed_vaa)?;
    let sale_id = SaleInit::get_sale_id(&payload)?;

    if let Ok(_) = SALE_STATUSES.load(deps.storage, sale_id) {
        return ContributorError::SaleAlreadyExists.std_err();
    }

    // deserialize to get the details of the sale
    let sale_init = SaleInit::deserialize(sale_id, &payload)?;
    SALES.save(deps.storage, sale_id, &sale_init.core)?;

    // set sale as active and save the duration of the sale
    SALE_STATUSES.save(deps.storage, sale_id, &SaleStatus::Active)?;
    SALE_TIMES.save(deps.storage, sale_id, &sale_init.core.times)?;

    // this should never happen, but we are double-checking
    // that there are not too many accepted tokens
    if sale_init.accepted_tokens.len() >= 256 {
        return ContributorError::TooManyAcceptedTokens.std_err();
    }

    // now save some initial states for contributions and allocations
    for (i, token) in sale_init.accepted_tokens.iter().enumerate() {
        if token.chain != CHAIN_ID {
            continue;
        }

        let token_index = i as u8;
        let token_key: TokenIndexKey = (sale_id, token_index.into());

        let asset_info = make_asset_info(deps.api, token.address.as_slice())?;
        ACCEPTED_ASSETS.save(deps.storage, token_key.clone(), &asset_info)?;

        let this = env.contract.address.clone();
        let asset_key = match asset_info {
            AssetInfo::NativeToken { denom } => {
                if query_balance(&deps.querier, this, denom.clone()).is_err() {
                    return ContributorError::NonexistentDenom.std_err();
                }
                (sale_id, denom)
            }
            AssetInfo::Token { contract_addr } => {
                let validated = deps.api.addr_validate(contract_addr.as_str())?;
                if query_token_balance(&deps.querier, validated, this).is_err() {
                    return ContributorError::NonexistentToken.std_err();
                }
                (sale_id, contract_addr)
            }
        };

        // store index so we can look up by denom/contract_addr
        if ASSET_INDICES.has(deps.storage, asset_key.clone()) {
            return ContributorError::DuplicateAcceptedToken.std_err();
        }
        ASSET_INDICES.save(deps.storage, asset_key, &token_index)?;

        // store other things associated with accepted tokens
        TOTAL_CONTRIBUTIONS.save(deps.storage, token_key.clone(), &Uint128::zero())?;
    }

    let sale = &sale_init.core;
    Ok(Response::new()
        .add_attribute("action", "init_sale")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64())
        .add_attribute("token_chain", sale.token_chain.to_string())
        .add_attribute(
            "token_address",
            Binary::from(sale.token_address.as_slice()).to_base64(),
        )
        .add_attribute("num_accepted_tokens", sale.num_accepted.to_string()))
}

// TODO : add signature argument
pub fn contribute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    amount: Uint128,
) -> StdResult<Response> {
    throw_if_inactive(deps.storage, sale_id)?;

    let times = SALE_TIMES.load(deps.storage, sale_id)?;
    let now = env.block.time.seconds();
    if now < times.start {
        return ContributorError::SaleNotStarted.std_err();
    } else if now > times.end {
        return ContributorError::SaleEnded.std_err();
    }

    let asset_info = ACCEPTED_ASSETS.load(deps.storage, (sale_id, token_index.into()))?;
    match asset_info {
        AssetInfo::NativeToken { denom } => {
            contribute_native(deps, env, info, sale_id, token_index, &denom, amount)
        }
        AssetInfo::Token { contract_addr } => contribute_token(
            deps,
            env,
            info,
            sale_id,
            token_index,
            &contract_addr,
            amount,
        ),
    }
}

pub fn attest_contributions(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    sale_id: &[u8],
) -> StdResult<Response> {
    throw_if_inactive(deps.storage, sale_id)?;

    let times = SALE_TIMES.load(deps.storage, sale_id)?;
    if env.block.time.seconds() <= times.end {
        return ContributorError::SaleNotFinished.std_err();
    }

    // Do we care if the orchestrator can attest contributions multiple times?
    // The conductor can only collect contributions once per chain, so there
    // is no need to add a protection against attesting more than once.
    // If we want to add a protection, we can cache the serialized payload
    // and check if this is already in storage per sale_id.

    let asset_indices = sale_asset_indices(deps.storage, sale_id);

    let mut contribution_sealed = ContributionsSealed::new(sale_id, CHAIN_ID, asset_indices.len());
    for &token_index in asset_indices.iter() {
        let contributions =
            TOTAL_CONTRIBUTIONS.load(deps.storage, (sale_id, token_index.into()))?;
        contribution_sealed.add_contribution(token_index, contributions)?;
    }

    let serialized = contribution_sealed.serialize();
    let num_bytes = serialized.len();

    let cfg = CONFIG.load(deps.storage)?;
    Ok(Response::new()
        .add_message(execute_contract_without_funds(
            &cfg.wormhole,
            to_binary(&WormholeExecuteMsg::PostMessage {
                message: Binary::from(serialized),
                nonce: WORMHOLE_NONCE,
            })?,
        ))
        .add_attribute("action", "attest_contributions")
        .add_attribute("num_bytes", num_bytes.to_string()))
}

pub fn sale_sealed(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    signed_vaa: Binary,
) -> StdResult<Response> {
    let payload = parse_and_verify_vaa(deps.as_ref(), &env, signed_vaa)?;
    let sale_id = SaleSealed::get_sale_id(&payload)?;

    throw_if_inactive(deps.storage, sale_id)?;

    let sale = SALES.load(deps.storage, sale_id)?;

    // sale token handling
    let asset_info = match sale.token_chain {
        CHAIN_ID => make_asset_info(deps.api, sale.token_address.as_slice())?,
        _ => {
            // get the wrapped address
            query_portal_wrapped_asset(
                deps.as_ref(),
                sale.token_chain,
                sale.token_address.as_slice(),
            )?
        }
    };

    let (balance, token_decimals) = match asset_info {
        AssetInfo::NativeToken { denom } => {
            // this should never happen, but...
            (
                query_balance(&deps.querier, env.contract.address, denom)?,
                6u8,
            )
        }
        AssetInfo::Token { contract_addr } => {
            let contract_addr = Addr::unchecked(contract_addr);
            let token_info: TokenInfoResponse = query_contract(
                &deps.querier,
                &contract_addr,
                to_binary(&Cw20QueryMsg::TokenInfo {})?,
            )?;

            let balance = query_token_balance(&deps.querier, contract_addr, env.contract.address)?;
            (balance, token_info.decimals)
        }
    };

    // save some work if we don't have any of the sale tokens
    if balance == Uint128::zero() {
        return ContributorError::InsufficientSaleTokens.std_err();
    }

    let asset_indices = sale_asset_indices(deps.storage, sale_id);

    // grab the allocations we care about (for Terra contributions)
    let parsed_allocations =
        SaleSealed::deserialize_allocations_safely(&payload, sale.num_accepted, &asset_indices)?;

    // Sum total allocations and check against balance in the contract.
    // Keep in mind, these are Uint256. Need to adjust this down to Uint128
    let total_allocations = parsed_allocations
        .iter()
        .fold(Uint256::zero(), |total, (_, next)| total + next.allocated);

    // need to adjust total_allocations based on decimal difference
    let total_allocations = sale.adjust_token_amount(total_allocations, token_decimals)?;

    if balance < total_allocations {
        return ContributorError::InsufficientSaleTokens.std_err();
    }

    // now that everything checks out, set the status to Sealed
    SALE_STATUSES.save(deps.storage, sale_id, &SaleStatus::Sealed)?;

    // transfer contributions to conductor
    let cfg = CONFIG.load(deps.storage)?;
    if cfg.conductor_chain == CHAIN_ID {
        return ContributorError::UnsupportedConductor.std_err();
    }

    let mut token_bridge_msgs: Vec<CosmosMsg> = Vec::with_capacity(sale.num_accepted as usize);
    for &token_index in asset_indices.iter() {
        // bridge assets to conductor
        let amount = TOTAL_CONTRIBUTIONS.load(deps.storage, (sale_id, token_index.into()))?;
        let asset = Asset {
            info: ACCEPTED_ASSETS.load(deps.storage, (sale_id, token_index.into()))?,
            amount,
        };

        token_bridge_msgs.push(execute_contract_without_funds(
            &cfg.token_bridge,
            to_binary(&TokenBridgeExecuteMsg::InitiateTransfer {
                asset,
                recipient_chain: cfg.conductor_chain,
                recipient: Binary::from(cfg.conductor_address.clone()),
                fee: Uint128::zero(), // does this matter?
                nonce: WORMHOLE_NONCE,
            })?,
        ));
    }

    // now update TOTAL_ALLOCATIONS (fix to use AssetAllocation)
    for (token_index, allocation) in parsed_allocations.iter() {
        // adjust values from uint256 to uint128
        let allocated = sale.adjust_token_amount(allocation.allocated, token_decimals)?;
        let excess_contributed = match to_uint128(allocation.excess_contributed) {
            Some(value) => value,
            None => return CommonError::AmountExceedsUint128Max.std_err(),
        };

        TOTAL_ALLOCATIONS.save(
            deps.storage,
            (sale_id, (*token_index).into()),
            &AssetAllocation {
                allocated,
                excess_contributed,
            },
        )?;
    }

    Ok(Response::new()
        .add_messages(token_bridge_msgs)
        .add_attribute("action", "sale_sealed")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64())
        .add_attribute("total_allocations", total_allocations.to_string()))
}

pub fn claim_allocation(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &Binary,
    token_index: u8,
) -> StdResult<Response> {
    throw_if_active(deps.storage, sale_id)?;

    Ok(Response::new().add_attribute("action", "claim_allocation"))
}

pub fn sale_aborted(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    signed_vaa: Binary,
) -> StdResult<Response> {
    let payload = parse_and_verify_vaa(deps.as_ref(), &env, signed_vaa)?;
    let sale_id = SaleAborted::get_sale_id(&payload)?;

    throw_if_inactive(deps.storage, sale_id)?;

    SALE_STATUSES.save(deps.storage, sale_id, &SaleStatus::Aborted)?;

    Ok(Response::new()
        .add_attribute("action", "sale_aborted")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64()))
}

pub fn claim_refund(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &Binary,
    token_index: u8,
) -> StdResult<Response> {
    throw_if_active(deps.storage, sale_id)?;

    Ok(Response::new().add_attribute("action", "claim_refund"))
}

/*
pub fn handle_upgrade_contract(_deps: DepsMut, env: Env, data: &Vec<u8>) -> StdResult<Response> {
    let UpgradeContract { new_contract } = UpgradeContract::deserialize(&data)?;

    Ok(Response::new()
        .add_message(CosmosMsg::Wasm(WasmMsg::Migrate {
            contract_addr: env.contract.address.to_string(),
            new_code_id: new_contract,
            msg: to_binary(&MigrateMsg {})?,
        }))
        .add_attribute("action", "contract_upgrade"))
}
*/

// helpers
fn contribute_native(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    denom: &String,
    amount: Uint128,
) -> StdResult<Response> {
    // we don't care about the amount in contribute (can be zero)
    // as long as we have some amount in the transaction
    let result = info
        .funds
        .iter()
        .find(|c| c.denom == *denom)
        .map(|c| Uint128::from(c.amount));

    match result {
        Some(funds) => {
            if funds != amount {
                return ContributorError::IncorrectFunds.std_err();
            }

            let status =
                update_buyer_contribution(deps.storage, sale_id, token_index, &info.sender, funds)?;

            match status {
                BuyerStatus::Active { contribution } => Ok(Response::new()
                    .add_attribute("action", "contribute_native")
                    .add_attribute("sale_id", Binary::from(sale_id).to_base64())
                    .add_attribute("token_index", token_index.to_string())
                    .add_attribute("denom", denom)
                    .add_attribute("amount", amount.to_string())
                    .add_attribute("contribution", contribution.to_string())),
                _ => ContributorError::SaleEnded.std_err(),
            }
        }
        None => ContributorError::IncorrectFunds.std_err(),
    }
}

fn contribute_token(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    contract_addr: &String,
    amount: Uint128,
) -> StdResult<Response> {
    // if this method is called again, we need to check whether
    // we are already processing the balance before the transfer
    if PENDING_CONTRIBUTE_TOKEN.load(deps.storage).is_ok() {
        return ContributorError::PendingContribute.std_err();
    }

    if amount == Uint128::zero() {
        return ContributorError::ZeroAmount.std_err();
    }

    let contract_addr = Addr::unchecked(contract_addr.as_str());

    let balance_before = query_token_balance(
        &deps.querier,
        contract_addr.clone(),
        env.contract.address.clone(),
    )?;

    // TODO: add targeted amount and check in hook
    PENDING_CONTRIBUTE_TOKEN.save(
        deps.storage,
        &PendingContributeToken {
            sale_id: sale_id.to_vec(),
            token_index,
            contract_addr: contract_addr.clone(),
            sender: info.sender.clone(),
            balance_before,
            check_amount: amount,
        },
    )?;

    Ok(Response::new()
        .add_message(execute_contract_without_funds(
            &contract_addr,
            to_binary(&Cw20ExecuteMsg::TransferFrom {
                owner: info.sender.to_string(),
                recipient: env.contract.address.to_string(),
                amount,
            })?,
        ))
        .add_message(execute_contract_without_funds(
            &env.contract.address,
            to_binary(&ExecuteMsg::EscrowUserContributionHook)?,
        ))
        .add_attribute("action", "contribute_token")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64())
        .add_attribute("token_index", token_index.to_string())
        .add_attribute("contract_addr", contract_addr)
        .add_attribute("amount", amount.to_string())
        .add_attribute("balance_before", balance_before.to_string()))
}

// external: wormhole
fn parse_and_verify_vaa(deps: Deps, env: &Env, vaa: Binary) -> StdResult<Vec<u8>> {
    let cfg = CONFIG.load(deps.storage)?;
    let parsed: ParsedVAA = query_contract(
        &deps.querier,
        &cfg.wormhole,
        to_binary(&WormholeQueryMsg::VerifyVAA {
            vaa,
            block_time: env.block.time.seconds(),
        })?,
    )?;

    // verify conductor
    if cfg.conductor_chain != parsed.emitter_chain
        || !cfg.conductor_address.eq(&parsed.emitter_address)
    {
        return Err(StdError::generic_err(format!(
            "invalid emitter: {}:{}",
            parsed.emitter_chain,
            hex::encode(&parsed.emitter_address),
        )));
    }

    Ok(parsed.payload)
}

fn query_portal_wrapped_asset(deps: Deps, chain: u16, address: &[u8]) -> StdResult<AssetInfo> {
    let cfg = CONFIG.load(deps.storage)?;
    let response: WrappedRegistryResponse = query_contract(
        &deps.querier,
        &cfg.token_bridge,
        to_binary(&TokenBridgeQueryMsg::WrappedRegistry {
            chain,
            address: Binary::from(address),
        })?,
    )?;

    Ok(AssetInfo::Token {
        contract_addr: response.address,
    })
}

fn query_contract<T: DeserializeOwned>(
    querier: &QuerierWrapper,
    contract: &Addr,
    msg: Binary,
) -> StdResult<T> {
    querier.query(&QueryRequest::Wasm(WasmQuery::Smart {
        contract_addr: contract.to_string(),
        msg,
    }))
}

// assume only one coin for funds
fn execute_contract_with_funds(contract: &Addr, msg: Binary, funds: Coin) -> CosmosMsg {
    CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: contract.to_string(),
        funds: vec![funds],
        msg,
    })
}

// no need for funds
fn execute_contract_without_funds(contract: &Addr, msg: Binary) -> CosmosMsg {
    CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: contract.to_string(),
        funds: vec![],
        msg,
    })
}
