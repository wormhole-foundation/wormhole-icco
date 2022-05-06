use cosmwasm_std::{Binary, Uint128};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use terraswap::asset::AssetInfo;

use icco::common::{SaleStatus, SaleTimes};

use crate::state::BuyerStatus;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub wormhole: String,
    pub token_bridge: String,

    pub conductor_chain: u16,
    pub conductor_address: Binary,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    InitSale {
        data: Binary,
    },

    Contribute {
        sale_id: Binary,
        token_index: u8,
        amount: Uint128,
    },

    EscrowUserContributionHook,

    AttestContributions {
        sale_id: Binary,
    },

    SaleSealed {
        data: Binary,
    },

    ClaimAllocation {
        sale_id: Binary,
        token_index: u8,
    },

    SaleAborted {
        data: Binary,
    },

    ClaimRefund {
        sale_id: Binary,
        token_index: u8,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct MigrateMsg {}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},

    Sale {
        sale_id: Binary,
    },

    SaleStatus {
        sale_id: Binary,
    },

    SaleTimes {
        sale_id: Binary,
    },

    TotalContribution {
        sale_id: Binary,
        token_index: u8,
    },

    TotalAllocation {
        sale_id: Binary,
        token_index: u8,
    },

    AcceptedAsset {
        sale_id: Binary,
        token_index: u8,
    },

    AssetIndex {
        sale_id: Binary,
        asset_info: AssetInfo,
    },

    BuyerStatus {
        sale_id: Binary,
        token_index: u8,
        buyer: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaleStatusResponse {
    pub id: Vec<u8>,
    pub status: SaleStatus,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaleTimesResponse {
    pub id: Vec<u8>,
    pub times: SaleTimes,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct TotalContributionResponse {
    pub id: Vec<u8>,
    pub token_index: u8,
    pub amount: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct TotalAllocationResponse {
    pub id: Vec<u8>,
    pub token_index: u8,
    pub amount: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct AcceptedAssetResponse {
    pub id: Vec<u8>,
    pub token_index: u8,
    pub asset_info: AssetInfo,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct BuyerStatusResponse {
    pub id: Vec<u8>,
    pub token_index: u8,
    pub buyer: String,
    pub asset_info: AssetInfo,
    pub status: BuyerStatus,
}
