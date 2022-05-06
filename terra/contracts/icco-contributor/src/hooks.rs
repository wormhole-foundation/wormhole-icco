use cosmwasm_std::{Binary, DepsMut, Env, MessageInfo, Response, StdResult};
use terraswap::querier::query_token_balance;

use crate::state::{BuyerStatus, BuyerTokenIndexKey, BUYER_STATUSES, PENDING_CONTRIBUTE_TOKEN};

pub fn escrow_user_contribution_hook(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
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

    let key: BuyerTokenIndexKey = (sale_id, token_index.into(), sender.clone());

    // add to user
    let status = BUYER_STATUSES.update(
        deps.storage,
        key,
        |status: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
            match status {
                Some(one) => Ok(BuyerStatus {
                    contribution: one.contribution + amount,
                    allocation_is_claimed: false,
                    refund_is_claimed: false,
                }),
                None => Ok(BuyerStatus {
                    contribution: amount,
                    allocation_is_claimed: false,
                    refund_is_claimed: false,
                }),
            }
        },
    )?;

    Ok(Response::new()
        .add_attribute("action", "escrow_user_contribution_hook")
        .add_attribute("pending.sale_id", Binary::from(pending.sale_id).to_base64())
        .add_attribute("pending.token_index", pending.token_index.to_string())
        .add_attribute("pending.contract_addr", pending.contract_addr)
        .add_attribute("pending.sender", sender)
        .add_attribute("pending.balance_before", pending.balance_before.to_string())
        .add_attribute("balance_after", balance_after.to_string())
        .add_attribute("amount", amount.to_string())
        .add_attribute("contribution", status.contribution.to_string()))
}
