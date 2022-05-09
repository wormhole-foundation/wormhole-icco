use cosmwasm_std::{
    to_binary, Addr, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, QueryRequest, Response,
    StdError, StdResult, Storage, Uint128, WasmMsg, WasmQuery,
};
use cw20::Cw20ExecuteMsg;
use terraswap::{
    asset::AssetInfo,
    querier::{query_balance, query_token_balance},
};

use token_bridge_terra::msg::{
    ExecuteMsg as TokenBridgeExecuteMsg, QueryMsg as TokenBridgeQueryMsg, WrappedRegistryResponse,
};
use wormhole::{
    msg::{ExecuteMsg as WormholeExecuteMsg, QueryMsg as WormholeQueryMsg},
    state::ParsedVAA,
};

use icco::common::{
    make_asset_info, ContributionsSealed, SaleAborted, SaleInit, SaleSealed, SaleStatus, CHAIN_ID,
};

use crate::{
    error::ContributorError,
    msg::ExecuteMsg,
    state::{
        is_sale_active, sale_asset_indices, update_buyer_contribution, AssetKey, BuyerStatus,
        PendingContributeToken, TokenIndexKey, ACCEPTED_ASSETS, ASSET_INDICES, CONFIG,
        PENDING_CONTRIBUTE_TOKEN, SALES, SALE_STATUSES, SALE_TIMES, TOTAL_ALLOCATIONS,
        TOTAL_CONTRIBUTIONS,
    },
};

// nonce means nothing?
const WORMHOLE_NONCE: u32 = 0;

pub fn init_sale(deps: DepsMut, env: Env, _info: MessageInfo, vaa: &Binary) -> StdResult<Response> {
    let parsed_vaa = query_wormhole_verify_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(deps.storage, &parsed_vaa)?;

    let vaa_payload = &parsed_vaa.payload;
    let sale_id = SaleInit::get_sale_id(vaa_payload)?;

    if is_sale_active(deps.storage, sale_id) {
        return ContributorError::SaleAlreadyExists.std_err();
    }

    let sale_init = SaleInit::deserialize(sale_id, vaa_payload)?;
    SALES.save(deps.storage, sale_id, &sale_init.core)?;

    // fresh status
    SALE_STATUSES.save(deps.storage, sale_id, &SaleStatus::Active)?;

    // and times
    SALE_TIMES.save(deps.storage, sale_id, &sale_init.core.times)?;

    let num_tokens = sale_init.accepted_tokens.len();
    if num_tokens >= 256 {
        return ContributorError::TooManyAcceptedTokens.std_err();
    }

    // now save some initial states for contributions and allocations
    for (i, token) in sale_init.accepted_tokens.iter().enumerate() {
        if token.chain != CHAIN_ID {
            continue;
        }

        let token_index = i as u8;
        let token_key: TokenIndexKey = (sale_id, token_index.into());

        let this = env.contract.address.clone();
        let asset_info = make_asset_info(deps.api, token.address.as_slice())?;
        let asset_key: AssetKey;
        match asset_info.clone() {
            AssetInfo::NativeToken { denom } => {
                if query_balance(&deps.querier, this, denom.clone()).is_err() {
                    return ContributorError::NonexistentDenom.std_err();
                }
                asset_key = (sale_id, denom);
            }
            AssetInfo::Token { contract_addr } => {
                let validated = deps.api.addr_validate(contract_addr.as_str())?;
                if query_token_balance(&deps.querier, validated, this).is_err() {
                    return ContributorError::NonexistentToken.std_err();
                }
                asset_key = (sale_id, contract_addr);
            }
        }
        // store index so we can look up by denom/contract_addr
        if ASSET_INDICES.has(deps.storage, asset_key.clone()) {
            return ContributorError::DuplicateAcceptedToken.std_err();
        }
        ASSET_INDICES.save(deps.storage, asset_key, &token_index)?;

        // store other things associated with accepted tokens
        ACCEPTED_ASSETS.save(deps.storage, token_key.clone(), &asset_info)?;
        TOTAL_CONTRIBUTIONS.save(deps.storage, token_key.clone(), &Uint128::zero())?;
        TOTAL_ALLOCATIONS.save(deps.storage, token_key, &Uint128::zero())?;
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
        .add_attribute("num_accepted_tokens", num_tokens.to_string()))
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
    if !is_sale_active(deps.storage, sale_id) {
        return ContributorError::SaleEnded.std_err();
    }

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

pub fn contribute_native(
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
                    .add_attribute("denom", denom)
                    .add_attribute("funds", funds.to_string())
                    .add_attribute("contribution", contribution.to_string())),
                _ => ContributorError::WrongBuyerStatus.std_err(),
            }
        }
        None => ContributorError::IncorrectFunds.std_err(),
    }
}

pub fn contribute_token(
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

    // TODO: use execute_contract
    Ok(Response::new()
        .add_message(CosmosMsg::Wasm(WasmMsg::Execute {
            contract_addr: contract_addr.to_string(),
            msg: to_binary(&Cw20ExecuteMsg::TransferFrom {
                owner: info.sender.to_string(),
                recipient: env.contract.address.to_string(),
                amount,
            })?,
            funds: vec![],
        }))
        .add_message(CosmosMsg::Wasm(WasmMsg::Execute {
            contract_addr: env.contract.address.to_string(),
            msg: to_binary(&ExecuteMsg::EscrowUserContributionHook)?,
            funds: vec![],
        }))
        .add_attribute("action", "contribute_token")
        .add_attribute("contract_addr", contract_addr)
        .add_attribute("amount", amount.to_string())
        .add_attribute("balance_before", balance_before.to_string()))
}

pub fn attest_contributions(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    sale_id: &[u8],
) -> StdResult<Response> {
    if !is_sale_active(deps.storage, sale_id) {
        return ContributorError::SaleEnded.std_err();
    }

    let times = SALE_TIMES.load(deps.storage, sale_id)?;
    if env.block.time.seconds() <= times.end {
        return ContributorError::SaleNotFinished.std_err();
    }

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
        .add_message(execute_contract(
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
    vaa: &Binary,
) -> StdResult<Response> {
    let parsed_vaa = query_wormhole_verify_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(deps.storage, &parsed_vaa)?;

    let payload = &parsed_vaa.payload;
    let sale_id = SaleSealed::get_sale_id(payload)?;

    let sale = match is_sale_active(deps.storage, sale_id) {
        true => SALES.load(deps.storage, sale_id)?,
        _ => {
            return ContributorError::SaleEnded.std_err();
        }
    };

    // sale token handling
    let asset_info = match sale.token_chain {
        CHAIN_ID => make_asset_info(deps.api, sale.token_address.as_slice())?,
        _ => {
            // get the wrapped address
            query_token_bridge_wrapped(
                deps.as_ref(),
                sale.token_chain,
                sale.token_address.as_slice(),
            )?
        }
    };

    let balance = match asset_info {
        AssetInfo::NativeToken { denom } => {
            // this should never happen, but...
            query_balance(&deps.querier, env.contract.address, denom)?
        }
        AssetInfo::Token { contract_addr } => query_token_balance(
            &deps.querier,
            Addr::unchecked(contract_addr),
            env.contract.address,
        )?,
    };
    // save some work if we don't have any of the sale tokens
    if balance == Uint128::zero() {
        return ContributorError::InsufficientSaleTokens.std_err();
    }

    let asset_indices = sale_asset_indices(deps.storage, sale_id);

    // grab the allocations we care about (for Terra contributions)
    let parsed_allocations =
        SaleSealed::deserialize_allocations_safely(payload, sale.num_accepted, &asset_indices)?;

    // sum total allocations and check against balance in the contract
    let total_allocations = parsed_allocations
        .iter()
        .fold(Uint128::zero(), |total, (_, next)| total + next.allocated);

    if balance < total_allocations {
        return ContributorError::InsufficientSaleTokens.std_err();
    }

    // now that everything checks out, set the status to Sealed
    SALE_STATUSES.save(deps.storage, sale_id, &SaleStatus::Sealed)?;

    // transfer contributions to conductor
    let cfg = CONFIG.load(deps.storage)?;
    if cfg.conductor_chain == CHAIN_ID {
        // lol
    } else {
        for &token_index in asset_indices.iter() {
            // do token bridge transfers here
        }
    }

    // now update TOTAL_ALLOCATIONS (fix to use AssetAllocation)
    for (token_index, allocation) in parsed_allocations.iter() {
        //TOTAL_ALLOCATIONS.save(deps.storage, (sale_id, token_index.into()), )
    }

    Ok(Response::new()
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
    // TODO devs do something

    Ok(Response::new().add_attribute("action", "claim_allocation"))
}

pub fn sale_aborted(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    vaa: &Binary,
) -> StdResult<Response> {
    let parsed_vaa = query_wormhole_verify_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(deps.storage, &parsed_vaa)?;

    let sale_id = SaleAborted::get_sale_id(&parsed_vaa.payload)?;

    if !is_sale_active(deps.storage, sale_id) {
        return ContributorError::SaleEnded.std_err();
    };

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
    // TODO devs do something

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

fn verify_conductor(storage: &mut dyn Storage, parsed: &ParsedVAA) -> StdResult<()> {
    let cfg = CONFIG.load(storage)?;

    if cfg.conductor_chain != parsed.emitter_chain
        || !cfg.conductor_address.eq(&parsed.emitter_address)
    {
        return Err(StdError::generic_err(format!(
            "invalid emitter: {}:{}",
            parsed.emitter_chain,
            hex::encode(&parsed.emitter_address),
        )));
    }

    Ok(())
}

// external: wormhole
fn query_wormhole_verify_vaa(deps: Deps, block_time: u64, data: &Binary) -> StdResult<ParsedVAA> {
    let cfg = CONFIG.load(deps.storage)?;
    let vaa: ParsedVAA = deps.querier.query(&QueryRequest::Wasm(WasmQuery::Smart {
        contract_addr: cfg.wormhole.to_string(),
        msg: to_binary(&WormholeQueryMsg::VerifyVAA {
            vaa: data.clone(),
            block_time,
        })?,
    }))?;
    Ok(vaa)
}

fn query_token_bridge_wrapped(deps: Deps, chain: u16, address: &[u8]) -> StdResult<AssetInfo> {
    let cfg = CONFIG.load(deps.storage)?;
    let response: WrappedRegistryResponse =
        deps.querier.query(&QueryRequest::Wasm(WasmQuery::Smart {
            contract_addr: cfg.token_bridge.to_string(),
            msg: to_binary(&TokenBridgeQueryMsg::WrappedRegistry {
                chain,
                address: Binary::from(address),
            })?,
        }))?;
    Ok(AssetInfo::Token {
        contract_addr: response.address,
    })
}

fn wormhole_post_message_hook(deps: Deps, bytes: Vec<u8>) -> StdResult<CosmosMsg> {
    let cfg = CONFIG.load(deps.storage)?;

    Ok(execute_contract(
        &cfg.wormhole,
        to_binary(&WormholeExecuteMsg::PostMessage {
            message: Binary::from(bytes),
            nonce: WORMHOLE_NONCE,
        })?,
    ))
}

// no need for funds
fn execute_contract(contract: &Addr, msg: Binary) -> CosmosMsg {
    CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: contract.to_string(),
        funds: vec![],
        msg,
    })
}
