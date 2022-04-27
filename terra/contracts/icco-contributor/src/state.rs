use cosmwasm_std::{StdResult, Storage, Uint128};
use cw_storage_plus::{Item, Map, U8Key};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use terraswap::asset::AssetInfo;
use wormhole::byte_utils::ByteUtils;

use icco::common::{AcceptedToken, SaleCore, SaleStatus, SaleTimes};

// per sale_id and token_index, we need to track a buyer's contribution, as well as whether
// he has been refunded or his allocations have been claimed
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BuyerStatus {
    pub contribution: Uint128,
    pub allocation_is_claimed: bool,
    pub refund_is_claimed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub wormhole_contract: HumanAddr,
    pub token_bridge_contract: HumanAddr,
    pub conductor_chain: u16,
    pub conductor_address: Vec<u8>,
    pub owner: HumanAddr,
}

pub struct SaleMessage<'a> {
    pub id: u8,
    pub payload: &'a [u8],
}

/*
pub struct UpgradeContract {
    pub new_contract: u64,
}
*/
pub struct UserAction;

impl UserAction {
    pub const CONTRIBUTE: u8 = 1;
}

pub type HumanAddr = String;
pub type SaleId<'a> = &'a [u8];
pub type TokenIndexKey<'a> = (SaleId<'a>, U8Key);
pub type BuyerTokenIndexKey<'a> = (SaleId<'a>, U8Key, &'a HumanAddr);

pub const CONFIG: Item<Config> = Item::new("config");
pub const SALES: Map<SaleId, SaleCore> = Map::new("sales");
pub const SALE_STATUSES: Map<SaleId, SaleStatus> = Map::new("sale_statuses");
pub const SALE_TIMES: Map<SaleId, SaleTimes> = Map::new("sale_times");
pub const ACCEPTED_ASSETS: Map<TokenIndexKey, AssetInfo> = Map::new("accepted_tokens");
pub const ACCEPTED_TOKENS: Map<TokenIndexKey, AcceptedToken> = Map::new("accepted_tokens");
pub const TOTAL_CONTRIBUTIONS: Map<TokenIndexKey, Uint128> = Map::new("total_contributions");
pub const TOTAL_ALLOCATIONS: Map<TokenIndexKey, Uint128> = Map::new("total_allocations");
pub const BUYER_STATUSES: Map<BuyerTokenIndexKey, BuyerStatus> = Map::new("buyer_statuses");
//pub const USER_ACTIONS: Map<SaleId, u8> = Map::new("user_actions");
//pub const TOKEN_CONTRIBUTE_TMP = Item<> = Item::new("token_contribute_tmp");

pub const ZERO_AMOUNT: Uint128 = Uint128::zero();

pub fn load_accepted_token(
    storage: &dyn Storage,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<AcceptedToken> {
    ACCEPTED_TOKENS.load(storage, (sale_id, token_index.into()))
}

pub fn load_total_contribution(
    storage: &dyn Storage,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<Uint128> {
    TOTAL_CONTRIBUTIONS.load(storage, (sale_id, token_index.into()))
}

pub fn load_total_allocation(
    storage: &dyn Storage,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<Uint128> {
    TOTAL_ALLOCATIONS.load(storage, (sale_id, token_index.into()))
}

/*
pub fn update_contribution(
    storage: &mut dyn Storage,
    block_time: u64,
    sale_id: &[u8],
    token_index: u8,
    buyer: &HumanAddr,
    contribution: Uint256,
) -> StdResult<BuyerStatus> {
    let token_index = U8Key::from(token_index);

    // check the status of the sale
    let status = SALE_STATUSES.load(storage, sale_id.to_vec())?;
    if status.is_aborted {
        return Err(StdError::generic_err("sale was aborted"));
    } else if status.is_sealed {
        return Err(StdError::generic_err("sale was sealed"));
    }

    // is the sale still happening?
    let times = SALE_TIMES.load(storage, sale_id.to_vec())?;
    if block_time < times.start {
        return Err(StdError::generic_err("sale has not started yet"));
    } else if block_time > times.end {
        return Err(StdError::generic_err("sale has ended"));
    }

    // update the buyer's contributions for a particular token
    let buyer_key: BuyerTokenIndexKey = (sale_id.to_vec(), token_index.clone(), buyer.clone());
    let action = |d: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
        match d {
            Some(status) => Ok(BuyerStatus {
                contribution: status.contribution + contribution,
                refund_is_claimed: status.refund_is_claimed,
                allocation_is_claimed: status.allocation_is_claimed,
            }),
            None => Ok(BuyerStatus {
                contribution,
                refund_is_claimed: false,
                allocation_is_claimed: false,
            }),
        }
    };
    let buyer_status = BUYER_STATUS.update(storage, buyer_key, action)?;

    // now update total contributions
    let token_key: TokenIndexKey = (sale_id.to_vec(), token_index.clone());
    let action = |d: Option<Uint256>| -> StdResult<Uint256> {
        match d {
            Some(current) => Ok(current + contribution),
            None => Err(StdError::generic_err("shouldn't be here")),
        }
    };
    TOTAL_CONTRIBUTIONS.update(storage, token_key, action)?;

    Ok(buyer_status)
}
*/

impl<'a> SaleMessage<'a> {
    pub fn deserialize(data: &'a [u8]) -> StdResult<Self> {
        Ok(SaleMessage {
            id: data.get_u8(0),
            payload: &data[1..],
        })
    }
}

/*
impl UpgradeContract {
    pub fn deserialize(data: &Vec<u8>) -> StdResult<Self> {
        let data = data.as_slice();
        let new_contract = data.get_u64(24);
        Ok(UpgradeContract { new_contract })
    }
}
*/
