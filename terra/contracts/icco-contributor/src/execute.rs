use cosmwasm_std::{
    to_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, Order, QueryRequest, Response,
    StdError, StdResult, Storage, Uint256, WasmMsg, WasmQuery,
};

use wormhole::{
    msg::{ExecuteMsg as WormholeExecuteMsg, QueryMsg as WormholeQueryMsg},
    state::ParsedVAA,
};

use crate::{
    error::ContributorError,
    shared::{AcceptedToken, ContributionsSealed, SaleAborted, SaleInit, SaleSealed, SaleStatus},
    state::{
        SaleMessage, TokenIndexKey, ACCEPTED_TOKENS, CHAIN_ID, CONFIG, SALES, SALE_STATUSES,
        SALE_TIMES, TOTAL_ALLOCATIONS, TOTAL_CONTRIBUTIONS, ZERO_AMOUNT,
    },
};

// nonce means nothing?
const WORMHOLE_NONCE: u32 = 0;

pub fn init_sale(deps: DepsMut, env: Env, _info: MessageInfo, vaa: &Binary) -> StdResult<Response> {
    let parsed = parse_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(
        deps.storage,
        parsed.emitter_chain,
        parsed.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed.payload.as_slice())?;
    if message.id != SaleInit::PAYLOAD_ID {
        return ContributorError::InvalidVAAAction.std_err();
    }

    let sale_init = SaleInit::deserialize(message.payload)?;
    let sale_id = sale_init.core.id.as_slice();

    let storage = deps.storage;
    if SALES.may_load(storage, sale_id)? != None {
        return ContributorError::SaleAlreadyExists.std_err();
    }

    SALES.save(storage, sale_id, &sale_init.core)?;

    // fresh status
    SALE_STATUSES.save(
        storage,
        sale_id,
        &SaleStatus {
            is_sealed: false,
            is_aborted: false,
        },
    )?;

    // and times
    SALE_TIMES.save(storage, sale_id, &sale_init.core.times)?;

    // now save some initial states for contributions and allocations
    for (i, token) in sale_init.accepted_tokens.iter().enumerate() {
        let token_index = i as u8;

        let key: TokenIndexKey = (sale_id, token_index.into());
        if token.chain == CHAIN_ID {
            // TODO: check if token is actual CW20
        }
        ACCEPTED_TOKENS.save(storage, key.clone(), &token)?;
        TOTAL_CONTRIBUTIONS.save(storage, key.clone(), &ZERO_AMOUNT)?;
        TOTAL_ALLOCATIONS.save(storage, key.clone(), &ZERO_AMOUNT)?;
    }

    let sale = &sale_init.core;
    Ok(Response::new()
        .add_attribute("action", "init_sale")
        .add_attribute("sale_id", hex::encode(&sale.id))
        .add_attribute("token_chain", sale.token_chain.to_string())
        .add_attribute("token_address", hex::encode(&sale.token_address)))
}

pub fn contribute(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
    token_index: u8,
    amount: Uint256,
) -> StdResult<Response> {
    // TODO : add signature argument
    let storage = deps.storage;
    let status = SALE_STATUSES.load(storage, sale_id)?;
    if status.is_aborted {
        return ContributorError::SaleAborted.std_err();
    }

    let times = SALE_TIMES.load(storage, sale_id)?;
    let now = env.block.time.seconds();
    if now < times.start {
        return ContributorError::SaleNotStarted.std_err();
    } else if now > times.end {
        return ContributorError::SaleEnded.std_err();
    }

    let token = ACCEPTED_TOKENS.load(storage, (sale_id, token_index.into()))?;
    if token.chain != CHAIN_ID {
        return ContributorError::WrongChain.std_err();
    }

    //assert!(USER_ACTION.load(deps.storage).is_err());

    Ok(Response::new()
        .add_attribute("action", "contribute")
        .add_attribute("sale_id", Binary::from(sale_id).to_base64())
        .add_attribute("token_address", Binary::from(token.address).to_base64()))
}

pub fn attest_contributions(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    sale_id: &[u8],
) -> StdResult<Response> {
    let storage = deps.storage;
    let status = SALE_STATUSES.load(storage, sale_id)?;
    if status.is_sealed || status.is_aborted {
        return ContributorError::SaleAlreadySealedOrAborted.std_err();
    }

    let times = SALE_TIMES.load(storage, sale_id)?;
    if env.block.time.seconds() <= times.end {
        return ContributorError::SaleNotFinished.std_err();
    }

    let accepted_tokens: Vec<AcceptedToken> = ACCEPTED_TOKENS
        .prefix(sale_id)
        .range(storage, None, None, Order::Ascending)
        .map(|item| -> AcceptedToken {
            let (_, token) = item.unwrap();
            token
        })
        .collect();

    let mut contribution_sealed = ContributionsSealed::new(sale_id, CHAIN_ID);
    for (token_index, token) in accepted_tokens.iter().enumerate() {
        if token.chain == CHAIN_ID {
            let token_index = token_index as u8;
            let contributions = TOTAL_CONTRIBUTIONS.load(storage, (sale_id, token_index.into()))?;
            contribution_sealed.add_contribution(token_index, contributions)?;
        }
    }

    let cfg = CONFIG.load(storage)?;

    let wormhole_message = CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: cfg.wormhole_contract,
        funds: vec![],
        msg: to_binary(&WormholeExecuteMsg::PostMessage {
            message: Binary::from(contribution_sealed.serialize()),
            nonce: WORMHOLE_NONCE,
        })?,
    });

    Ok(Response::new()
        .add_attribute("action", "attest_contributions")
        .add_message(wormhole_message))
}

pub fn sale_sealed(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    vaa: &Binary,
) -> StdResult<Response> {
    let parsed = parse_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(
        deps.storage,
        parsed.emitter_chain,
        parsed.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed.payload.as_slice())?;
    if message.id != SaleSealed::PAYLOAD_ID {
        return ContributorError::InvalidVAAAction.std_err();
    }

    let sale_sealed = SaleSealed::deserialize(message.payload)?;
    let sale_id = sale_sealed.sale_id.as_slice();

    let storage = deps.storage;
    let status = SALE_STATUSES.load(storage, sale_id)?;
    if status.is_sealed || status.is_aborted {
        return ContributorError::SaleAlreadySealedOrAborted.std_err();
    }

    let sale = SALES.load(storage, sale_id)?;

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
        storage,
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

    let accepted_tokens: Vec<AcceptedToken> = ACCEPTED_TOKENS
        .prefix(sale_id)
        .range(storage, None, None, Order::Ascending)
        .map(|item| -> AcceptedToken {
            let (_, token) = item.unwrap();
            token
        })
        .collect();

    // transfer contributions to conductor
    let cfg = CONFIG.load(storage)?;
    if cfg.conductor_chain == CHAIN_ID {
        // lol
    } else {
        for token in accepted_tokens.iter() {
            if token.chain != CHAIN_ID {
                continue;
            }

            // do token bridge transfers here
            let _address = token.address.clone();
        }
    }

    Ok(Response::new()
        .add_attribute("action", "sale_sealed")
        .add_attribute("sale_id", hex::encode(sale_id)))
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
    let parsed = parse_vaa(deps.as_ref(), env.block.time.seconds(), vaa)?;
    verify_conductor(
        deps.storage,
        parsed.emitter_chain,
        parsed.emitter_address.as_slice(),
    )?;

    let message = SaleMessage::deserialize(parsed.payload.as_slice())?;
    if message.id != SaleAborted::PAYLOAD_ID {
        return ContributorError::InvalidVAAAction.std_err();
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
        .add_attribute("sale_id", hex::encode(sale.id)))
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

fn parse_vaa(deps: Deps, block_time: u64, data: &Binary) -> StdResult<ParsedVAA> {
    let cfg = CONFIG.load(deps.storage)?;
    let vaa: ParsedVAA = deps.querier.query(&QueryRequest::Wasm(WasmQuery::Smart {
        contract_addr: cfg.wormhole_contract.clone(),
        msg: to_binary(&WormholeQueryMsg::VerifyVAA {
            vaa: data.clone(),
            block_time,
        })?,
    }))?;
    Ok(vaa)
}
