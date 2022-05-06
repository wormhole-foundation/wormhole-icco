use cosmwasm_std::{Addr, StdResult, Storage, Uint128};
use cw_storage_plus::{Item, Map, U8Key};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use terraswap::asset::AssetInfo;
use wormhole::byte_utils::ByteUtils;

use icco::common::{SaleCore, SaleStatus, SaleTimes};

use crate::error::ContributorError;

// per sale_id and token_index, we need to track a buyer's contribution, as well as whether
// he has been refunded or his allocations have been claimed

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum BuyerStatus {
    Active {
        contribution: Uint128,
    },
    AllocationIsClaimed {
        allocation: Uint128,
        excess: Uint128,
    },
    RefundIsClaimed {
        amount: Uint128,
    },
}

/*
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BuyerStatus {
    pub contribution: Uint128,
    pub state: BuyerState,
    //pub allocation_is_claimed: bool,
    //pub refund_is_claimed: bool,
}
*/

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub wormhole: Addr,
    pub token_bridge: Addr,
    pub conductor_chain: u16,
    pub conductor_address: Vec<u8>,
    pub owner: Addr,
}

pub struct SaleMessage<'a> {
    pub id: u8,
    pub payload: &'a [u8],
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PendingContributeToken {
    pub sale_id: Vec<u8>,
    pub token_index: u8,
    pub contract_addr: Addr,
    pub sender: Addr,
    pub balance_before: Uint128,
}

/*
pub struct UpgradeContract {
    pub new_contract: u64,
}
*/
//pub type HumanAddr = String;
pub type SaleId<'a> = &'a [u8];
pub type TokenIndexKey<'a> = (SaleId<'a>, U8Key);
pub type AssetKey<'a> = (SaleId<'a>, String);
pub type BuyerTokenIndexKey<'a> = (SaleId<'a>, U8Key, Addr);

pub const CONFIG: Item<Config> = Item::new("config");
pub const SALES: Map<SaleId, SaleCore> = Map::new("sales");
pub const SALE_STATUSES: Map<SaleId, SaleStatus> = Map::new("sale_statuses");
pub const SALE_TIMES: Map<SaleId, SaleTimes> = Map::new("sale_times");
pub const ACCEPTED_ASSETS: Map<TokenIndexKey, AssetInfo> = Map::new("accepted_assets");
pub const TOTAL_CONTRIBUTIONS: Map<TokenIndexKey, Uint128> = Map::new("total_contributions");
pub const TOTAL_ALLOCATIONS: Map<TokenIndexKey, Uint128> = Map::new("total_allocations");

// per buyer
pub const BUYER_STATUSES: Map<BuyerTokenIndexKey, BuyerStatus> = Map::new("buyer_statuses");

// per asset
pub const ASSET_INDICES: Map<AssetKey, u8> = Map::new("asset_indices");

pub const PENDING_CONTRIBUTE_TOKEN: Item<PendingContributeToken> =
    Item::new("pending_contribute_token");

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

pub fn update_buyer_contribution(
    storage: &mut dyn Storage,
    key: BuyerTokenIndexKey,
    amount: Uint128,
) -> StdResult<BuyerStatus> {
    BUYER_STATUSES.update(
        storage,
        key,
        |result: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
            match result {
                Some(one) => match one {
                    BuyerStatus::Active { contribution } => Ok(BuyerStatus::Active {
                        contribution: contribution + amount,
                    }),
                    _ => ContributorError::BuyerNotActive.std_err(),
                },
                None => Ok(BuyerStatus::Active {
                    contribution: amount,
                }),
            }
        },
    )
}

pub fn allocation_is_claimed(
    storage: &mut dyn Storage,
    key: BuyerTokenIndexKey,
    allocation: Uint128,
    excess: Uint128,
) -> StdResult<BuyerStatus> {
    BUYER_STATUSES.update(
        storage,
        key,
        |result: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
            match result {
                Some(one) => match one {
                    BuyerStatus::Active { contribution: _ } => {
                        Ok(BuyerStatus::AllocationIsClaimed { allocation, excess })
                    }
                    _ => ContributorError::BuyerNotActive.std_err(),
                },
                None => ContributorError::NonexistentBuyer.std_err(),
            }
        },
    )
}

pub fn refund_is_claimed(
    storage: &mut dyn Storage,
    key: BuyerTokenIndexKey,
) -> StdResult<BuyerStatus> {
    BUYER_STATUSES.update(
        storage,
        key,
        |result: Option<BuyerStatus>| -> StdResult<BuyerStatus> {
            match result {
                Some(one) => match one {
                    BuyerStatus::Active { contribution } => Ok(BuyerStatus::RefundIsClaimed {
                        amount: contribution,
                    }),
                    _ => ContributorError::BuyerNotActive.std_err(),
                },
                None => ContributorError::NonexistentBuyer.std_err(),
            }
        },
    )
}
