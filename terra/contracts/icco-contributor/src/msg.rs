use cosmwasm_std::{Binary, Uint128, Uint256};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use terraswap::asset::AssetInfo;

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

    SaleRegistry {
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
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct ConfigResponse {
    pub conductor_chain: u16,
    pub conductor_address: Vec<u8>,
    pub owner: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaleRegistryResponse {
    pub id: Vec<u8>,
    pub token_address: Vec<u8>,
    pub token_chain: u16,
    pub token_amount: Uint256,
    pub min_raise: Uint256,
    pub max_raise: Uint256,
    pub sale_start: u64,
    pub sale_end: u64,
    pub recipient: Vec<u8>,
    pub refund_recipient: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaleStatusResponse {
    pub id: Vec<u8>,
    pub is_sealed: bool,
    pub is_aborted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaleTimesResponse {
    pub id: Vec<u8>,
    pub start: u64,
    pub end: u64,
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
