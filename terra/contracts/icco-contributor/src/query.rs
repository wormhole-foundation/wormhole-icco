use cosmwasm_std::{Deps, StdResult};
use terraswap::asset::AssetInfo;

use crate::{
    error::ContributorError,
    msg::{
        AcceptedAssetResponse, ConfigResponse, SaleRegistryResponse, SaleStatusResponse,
        SaleTimesResponse, TotalAllocationResponse, TotalContributionResponse,
    },
    state::{
        ACCEPTED_ASSETS, ASSET_INDICES, CONFIG, SALES, SALE_STATUSES, SALE_TIMES,
        TOTAL_ALLOCATIONS, TOTAL_CONTRIBUTIONS,
    },
};

pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let result = CONFIG.load(deps.storage);
    match result {
        Ok(cfg) => Ok(ConfigResponse {
            conductor_chain: cfg.conductor_chain,
            conductor_address: cfg.conductor_address,
            owner: cfg.owner.to_string(),
        }),
        Err(_) => ContributorError::NotInitialized.std_err(),
    }
}

pub fn query_sale_registry(deps: Deps, sale_id: &[u8]) -> StdResult<SaleRegistryResponse> {
    let result = SALES.load(deps.storage, sale_id);
    match result {
        Ok(sale) => Ok(SaleRegistryResponse {
            id: sale.id,
            token_address: sale.token_address,
            token_chain: sale.token_chain,
            token_amount: sale.token_amount,
            min_raise: sale.min_raise,
            max_raise: sale.max_raise,
            sale_start: sale.times.start,
            sale_end: sale.times.end,
            recipient: sale.recipient,
            refund_recipient: sale.refund_recipient,
        }),
        Err(_) => ContributorError::SaleNotFound.std_err(),
    }
}

pub fn query_sale_status(deps: Deps, sale_id: &[u8]) -> StdResult<SaleStatusResponse> {
    let result = SALE_STATUSES.load(deps.storage, sale_id);
    match result {
        Ok(status) => Ok(SaleStatusResponse {
            id: sale_id.to_vec(),
            is_sealed: status.is_sealed,
            is_aborted: status.is_aborted,
        }),
        Err(_) => ContributorError::SaleStatusNotFound.std_err(),
    }
}

pub fn query_sale_times(deps: Deps, sale_id: &[u8]) -> StdResult<SaleTimesResponse> {
    let result = SALE_TIMES.load(deps.storage, sale_id);
    match result {
        Ok(times) => Ok(SaleTimesResponse {
            id: sale_id.to_vec(),
            start: times.start,
            end: times.end,
        }),
        Err(_) => ContributorError::SaleTimesNotFound.std_err(),
    }
}

pub fn query_total_contribution(
    deps: Deps,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<TotalContributionResponse> {
    let result = TOTAL_CONTRIBUTIONS.load(deps.storage, (sale_id, token_index.into()));
    match result {
        Ok(amount) => Ok(TotalContributionResponse {
            id: sale_id.to_vec(),
            token_index,
            amount,
        }),
        Err(_) => ContributorError::ContributionNotFound.std_err(),
    }
}

pub fn query_total_allocation(
    deps: Deps,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<TotalAllocationResponse> {
    let result = TOTAL_ALLOCATIONS.load(deps.storage, (sale_id, token_index.into()));
    match result {
        Ok(amount) => Ok(TotalAllocationResponse {
            id: sale_id.to_vec(),
            token_index,
            amount,
        }),
        Err(_) => ContributorError::AllocationNotFound.std_err(),
    }
}

pub fn query_accepted_asset(
    deps: Deps,
    sale_id: &[u8],
    token_index: u8,
) -> StdResult<AcceptedAssetResponse> {
    let result = ACCEPTED_ASSETS.load(deps.storage, (sale_id, token_index.into()));
    match result {
        Ok(asset_info) => Ok(AcceptedAssetResponse {
            id: sale_id.to_vec(),
            token_index,
            asset_info,
        }),
        Err(_) => ContributorError::AssetNotFound.std_err(),
    }
}

pub fn query_asset_index(
    deps: Deps,
    sale_id: &[u8],
    asset_info: AssetInfo,
) -> StdResult<AcceptedAssetResponse> {
    let result = match asset_info.clone() {
        AssetInfo::NativeToken { denom } => ASSET_INDICES.load(deps.storage, (sale_id, denom)),
        AssetInfo::Token { contract_addr } => {
            ASSET_INDICES.load(deps.storage, (sale_id, contract_addr))
        }
    };
    match result {
        Ok(token_index) => Ok(AcceptedAssetResponse {
            id: sale_id.to_vec(),
            asset_info,
            token_index,
        }),
        Err(_) => ContributorError::AssetNotFound.std_err(),
    }
}
