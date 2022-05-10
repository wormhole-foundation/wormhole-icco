use cosmwasm_std::{Binary, DepsMut, Env, MessageInfo, Response, StdResult};
use terraswap::querier::query_token_balance;

use crate::{
    error::ContributorError,
    state::{update_buyer_contribution, BuyerStatus, PENDING_CONTRIBUTE_TOKEN},
};

pub fn escrow_user_contribution_hook(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
) -> StdResult<Response> {
    let pending = PENDING_CONTRIBUTE_TOKEN.load(deps.storage)?;
    PENDING_CONTRIBUTE_TOKEN.remove(deps.storage);

    let balance_after = query_token_balance(
        &deps.querier,
        pending.contract_addr.clone(),
        env.contract.address.clone(),
    )?;

    let amount = balance_after - pending.balance_before;
    if amount != pending.check_amount {
        return ContributorError::FeeTokensForbidden.std_err();
    }

    let sale_id = pending.sale_id.as_slice();
    let token_index = pending.token_index;

    // add to user
    let status =
        update_buyer_contribution(deps.storage, sale_id, token_index, &pending.sender, amount)?;

    match status {
        BuyerStatus::Active { contribution } => Ok(Response::new()
            .add_attribute("action", "escrow_user_contribution_hook")
            .add_attribute("balance_after", balance_after.to_string())
            .add_attribute("change", amount.to_string())
            .add_attribute("contribution", contribution.to_string())),
        _ => ContributorError::WrongBuyerStatus.std_err(),
    }
}
