use cosmwasm_std::{DepsMut, Env, MessageInfo, Response, StdResult};
use terraswap::querier::query_token_balance;

use crate::state::PENDING_CONTRIBUTE_TOKEN;

pub fn escrow_user_contribution_hook(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
) -> StdResult<Response> {
    let pending = PENDING_CONTRIBUTE_TOKEN.load(deps.storage)?;
    PENDING_CONTRIBUTE_TOKEN.remove(deps.storage);

    let balance_after = query_token_balance(
        &deps.querier,
        pending.contract_addr,
        env.contract.address.clone(),
    )?;

    let amount = balance_after - pending.balance_before;

    Ok(Response::new())
}
