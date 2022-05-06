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

    let sale_id = pending.sale_id.as_slice();
    let token_index = pending.token_index;
    let sender = pending.sender;

    // add to user
    let status = update_buyer_contribution(
        deps.storage,
        (sale_id, token_index.into(), sender.clone()),
        amount,
    )?;

    match status {
        BuyerStatus::Active { contribution } => Ok(Response::new()
            .add_attribute("action", "escrow_user_contribution_hook")
            .add_attribute("pending.sale_id", Binary::from(pending.sale_id).to_base64())
            .add_attribute("pending.token_index", pending.token_index.to_string())
            .add_attribute("pending.contract_addr", pending.contract_addr)
            .add_attribute("pending.sender", sender)
            .add_attribute("pending.balance_before", pending.balance_before.to_string())
            .add_attribute("balance_after", balance_after.to_string())
            .add_attribute("amount", amount.to_string())
            .add_attribute("contribution", contribution.to_string())),
        _ => ContributorError::WrongBuyerStatus.std_err(),
    }
}
