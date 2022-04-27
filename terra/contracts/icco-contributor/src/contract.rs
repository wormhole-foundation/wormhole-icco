use cosmwasm_std::{
    entry_point, to_binary, Binary, Deps, DepsMut, Env, MessageInfo, Reply, Response, StdResult,
};

use crate::{
    execute::{
        attest_contributions, claim_allocation, claim_refund, contribute, init_sale, sale_aborted,
        sale_sealed,
    },
    msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg},
    query::{
        query_accepted_token, query_config, query_sale_registry, query_sale_status,
        query_sale_times, query_total_allocation, query_total_contribution,
    },
    state::{Config, CONFIG},
};

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(_deps: DepsMut, _env: Env, _msg: MigrateMsg) -> StdResult<Response> {
    Ok(Response::new())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let cfg = Config {
        wormhole_contract: msg.wormhole_contract,
        token_bridge_contract: msg.token_bridge_contract,
        conductor_chain: msg.conductor_chain,
        conductor_address: msg.conductor_address.into(),
        owner: info.sender.to_string(),
    };
    CONFIG.save(deps.storage, &cfg)?;

    Ok(Response::default())
}

// When CW20 transfers complete, we need to verify the actual amount that is being transferred out
// of the bridge. This is to handle fee tokens where the amount expected to be transferred may be
// less due to burns, fees, etc.
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn reply(_deps: DepsMut, _env: Env, _msg: Reply) -> StdResult<Response> {
    Ok(Response::default())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    match msg {
        ExecuteMsg::InitSale { data } => init_sale(deps, env, info, &data),
        ExecuteMsg::Contribute {
            sale_id,
            token_index,
            amount,
        } => contribute(deps, env, info, sale_id.as_slice(), token_index, amount),
        ExecuteMsg::AttestContributions { sale_id } => {
            attest_contributions(deps, env, info, &sale_id)
        }
        ExecuteMsg::SaleSealed { data } => sale_sealed(deps, env, info, &data),
        ExecuteMsg::ClaimAllocation {
            sale_id,
            token_index,
        } => claim_allocation(deps, env, info, &sale_id, token_index),
        ExecuteMsg::SaleAborted { data } => sale_aborted(deps, env, info, &data),
        ExecuteMsg::ClaimRefund {
            sale_id,
            token_index,
        } => claim_refund(deps, env, info, &sale_id, token_index),
    }
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_binary(&query_config(deps)?),
        QueryMsg::SaleRegistry { sale_id } => to_binary(&query_sale_registry(deps, &sale_id)?),
        QueryMsg::SaleStatus { sale_id } => to_binary(&query_sale_status(deps, &sale_id)?),
        QueryMsg::SaleTimes { sale_id } => to_binary(&query_sale_times(deps, &sale_id)?),
        QueryMsg::AcceptedToken {
            sale_id,
            token_index,
        } => to_binary(&query_accepted_token(deps, &sale_id, token_index)?),
        QueryMsg::TotalContribution {
            sale_id,
            token_index,
        } => to_binary(&query_total_contribution(deps, &sale_id, token_index)?),
        QueryMsg::TotalAllocation {
            sale_id,
            token_index,
        } => to_binary(&query_total_allocation(deps, &sale_id, token_index)?),
    }
}
