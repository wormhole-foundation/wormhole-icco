use cosmwasm_std::{
    to_binary, Addr, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, Order, QueryRequest,
    Response, StdError, StdResult, Storage, Uint128, WasmMsg, WasmQuery,
};
use cw20::Cw20ExecuteMsg;
use terraswap::{
    asset::AssetInfo,
    querier::{query_balance, query_token_balance},
};

use wormhole::{
    msg::{ExecuteMsg as WormholeExecuteMsg, QueryMsg as WormholeQueryMsg},
    state::ParsedVAA,
};

use icco::common::{ContributionsSealed, SaleAborted, SaleInit, SaleSealed, SaleStatus, CHAIN_ID};

use crate::{
    error::ContributorError,
    msg::ExecuteMsg,
    state::{
        AssetKey, BuyerStatus, BuyerTokenIndexKey, PendingContributeToken, SaleMessage,
        TokenIndexKey, ACCEPTED_ASSETS, ASSET_INDICES, BUYER_STATUSES, CONFIG,
        PENDING_CONTRIBUTE_TOKEN, SALES, SALE_STATUSES, SALE_TIMES, TOTAL_ALLOCATIONS,
        TOTAL_CONTRIBUTIONS,
    },
};

// nonce means nothing?
const WORMHOLE_NONCE: u32 = 0;

pub fn init_sale(deps: DepsMut, env: Env, _info: MessageInfo, vaa: &Binary) -> StdResult<Response> {
    let parsed_vaa = query_wormhole_verify_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(
        deps.storage,
        parsed_vaa.emitter_chain,
        parsed_vaa.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed_vaa.payload.as_slice())?;
    if message.id != SaleInit::PAYLOAD_ID {
        return ContributorError::InvalidVaaAction.std_err();
    }

    let sale_init = SaleInit::deserialize(message.payload)?;
    let sale_id = sale_init.core.id.as_slice();

    if SALES.may_load(deps.storage, sale_id)? != None {
        return ContributorError::SaleAlreadyExists.std_err();
    }

    SALES.save(deps.storage, sale_id, &sale_init.core)?;

    // fresh status
    SALE_STATUSES.save(
        deps.storage,
        sale_id,
        &SaleStatus {
            is_sealed: false,
            is_aborted: false,
        },
    )?;

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
        let asset_info = token.make_asset_info(deps.api)?;
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
        .add_attribute("sale_id", Binary::from(sale.id.as_slice()).to_base64())
        .add_attribute("token_chain", sale.token_chain.to_string())
        .add_attribute(
            "token_address",
            Binary::from(sale.token_address.as_slice()).to_base64(),
        )
        .add_attribute("num_accepted_tokens", num_tokens.to_string()))
}

// TODO : add signature argument
pub fn contribute(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    amount: Uint128,
) -> StdResult<Response> {
    let status = SALE_STATUSES.load(deps.storage, sale_id)?;
    if status.is_aborted {
        return ContributorError::SaleAborted.std_err();
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
            contribute_native(deps, env, info, sale_id, token_index, &denom)
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
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    denom: &String,
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
            let key: BuyerTokenIndexKey = (sale_id, token_index.into(), info.sender);
            let status = BUYER_STATUSES.update(
                deps.storage,
                key,
                |status: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
                    match status {
                        Some(one) => Ok(BuyerStatus {
                            contribution: one.contribution + funds,
                            allocation_is_claimed: false,
                            refund_is_claimed: false,
                        }),
                        None => Ok(BuyerStatus {
                            contribution: funds,
                            allocation_is_claimed: false,
                            refund_is_claimed: false,
                        }),
                    }
                },
            )?;

            Ok(Response::new()
                .add_attribute("action", "contribute_native")
                .add_attribute("sale_id", Binary::from(sale_id).to_base64())
                .add_attribute("denom", denom)
                .add_attribute("funds", funds.to_string())
                .add_attribute("contribution", status.contribution.to_string()))
        }
        None => ContributorError::InsufficientFunds.std_err(),
    }
}

pub fn contribute_token(
    mut deps: DepsMut,
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

    PENDING_CONTRIBUTE_TOKEN.save(
        deps.storage,
        &PendingContributeToken {
            sale_id: sale_id.to_vec(),
            token_index,
            contract_addr: contract_addr.clone(),
            sender: info.sender.clone(),
            balance_before,
        },
    )?;

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
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
) -> StdResult<Response> {
    let status = SALE_STATUSES.load(deps.storage, sale_id)?;
    if status.is_sealed || status.is_aborted {
        return ContributorError::SaleAlreadySealedOrAborted.std_err();
    }

    let times = SALE_TIMES.load(deps.storage, sale_id)?;
    if env.block.time.seconds() <= times.end {
        return ContributorError::SaleNotFinished.std_err();
    }

    let asset_indices: Vec<u8> = ASSET_INDICES
        .prefix(sale_id)
        .range(deps.storage, None, None, Order::Ascending)
        .map(|item| -> u8 {
            let (_, index) = item.unwrap();
            index
        })
        .collect();

    let mut contribution_sealed = ContributionsSealed::new(sale_id, CHAIN_ID);
    for &token_index in asset_indices.iter() {
        let contributions =
            TOTAL_CONTRIBUTIONS.load(deps.storage, (sale_id, token_index.into()))?;
        contribution_sealed.add_contribution(token_index, contributions)?;
    }

    let serialized = contribution_sealed.serialize();
    let num_bytes = serialized.len();

    Ok(Response::new()
        .add_message(wormhole_post_message_hook(deps.as_ref(), serialized)?)
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
    verify_conductor(
        deps.storage,
        parsed_vaa.emitter_chain,
        parsed_vaa.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed_vaa.payload.as_slice())?;
    if message.id != SaleSealed::PAYLOAD_ID {
        return ContributorError::InvalidVaaAction.std_err();
    }

    let sale_sealed = SaleSealed::deserialize(message.payload)?;
    let sale_id = sale_sealed.sale_id.as_slice();

    let status = SALE_STATUSES.load(deps.storage, sale_id)?;
    if status.is_sealed || status.is_aborted {
        return ContributorError::SaleAlreadySealedOrAborted.std_err();
    }

    let sale = SALES.load(deps.storage, sale_id)?;

    // sale token handling
    if sale.token_chain == CHAIN_ID {
        // lol
    } else {
        // get the wrapped address
        // verify balance is > 0
        // sum total allocations
        // verify the balance is >= total allocations
    }

    SALE_STATUSES.update(
        deps.storage,
        sale_id,
        |status: Option<SaleStatus>| -> StdResult<SaleStatus> {
            match status {
                Some(_) => Ok(SaleStatus {
                    is_sealed: true,
                    is_aborted: false,
                }),
                None => ContributorError::SaleNotFound.std_err(),
            }
        },
    )?;

    let asset_indices: Vec<u8> = ASSET_INDICES
        .prefix(sale_id)
        .range(deps.storage, None, None, Order::Ascending)
        .map(|result| -> u8 {
            let (_, index) = result.unwrap();
            index
        })
        .collect();

    // transfer contributions to conductor
    let cfg = CONFIG.load(deps.storage)?;
    if cfg.conductor_chain == CHAIN_ID {
        // lol
    } else {
        for &token_index in asset_indices.iter() {
            // do token bridge transfers here
        }
    }

    Ok(Response::new()
        .add_attribute("action", "sale_sealed")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64()))
}

pub fn claim_allocation(
    mut deps: DepsMut,
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
    let parsed = query_wormhole_verify_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(
        deps.storage,
        parsed.emitter_chain,
        parsed.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed.payload.as_slice())?;
    if message.id != SaleAborted::PAYLOAD_ID {
        return ContributorError::InvalidVaaAction.std_err();
    }

    let sale_aborted = SaleAborted::deserialize(message.payload)?;
    let sale_id = sale_aborted.sale_id.as_slice();
    let sale = SALES.load(deps.storage, sale_id)?;

    SALE_STATUSES.update(
        deps.storage,
        sale_id,
        |status: Option<SaleStatus>| -> StdResult<SaleStatus> {
            match status {
                Some(_) => Ok(SaleStatus {
                    is_sealed: false,
                    is_aborted: true,
                }),
                None => ContributorError::SaleNotFound.std_err(),
            }
        },
    )?;

    Ok(Response::new()
        .add_attribute("action", "sale_aborted")
        .add_attribute("sale_id", Binary::from(sale.id).to_base64()))
}

pub fn claim_refund(
    mut deps: DepsMut,
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

fn verify_conductor(
    storage: &mut dyn Storage,
    emitter_chain: u16,
    emitter_address: &[u8],
) -> StdResult<()> {
    let cfg = CONFIG.load(storage)?;

    if cfg.conductor_chain != emitter_chain || !cfg.conductor_address.eq(emitter_address) {
        return Err(StdError::generic_err(format!(
            "invalid emitter: {}:{}",
            emitter_chain,
            hex::encode(emitter_address),
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

fn wormhole_post_message_hook(deps: Deps, bytes: Vec<u8>) -> StdResult<CosmosMsg> {
    let cfg = CONFIG.load(deps.storage)?;

    Ok(CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: cfg.wormhole.to_string(),
        funds: vec![],
        msg: to_binary(&WormholeExecuteMsg::PostMessage {
            message: Binary::from(bytes),
            nonce: WORMHOLE_NONCE,
        })?,
    }))
}
