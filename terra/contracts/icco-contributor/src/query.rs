use cosmwasm_std::{Binary, Deps, StdResult};

use crate::{
    error::ContributorError,
    msg::{
        AcceptedTokenResponse, ConfigResponse, SaleRegistryResponse, SaleStatusResponse,
        SaleTimesResponse, TotalAllocationResponse, TotalContributionResponse,
    },
    state::{
        load_accepted_token, load_total_allocation, load_total_contribution, CONFIG, SALES,
        SALE_STATUSES, SALE_TIMES,
    },
};

pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    match CONFIG.load(deps.storage) {
        Ok(cfg) => Ok(ConfigResponse {
            conductor_chain: cfg.conductor_chain,
            conductor_address: cfg.conductor_address,
        }),
        Err(_) => ContributorError::NotInitialized.std_err(),
    }
}

pub fn query_sale_registry(deps: Deps, sale_id: &Binary) -> StdResult<SaleRegistryResponse> {
    match SALES.load(deps.storage, sale_id.as_slice()) {
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

pub fn query_sale_status(deps: Deps, sale_id: &Binary) -> StdResult<SaleStatusResponse> {
    let sale_id = sale_id.as_slice();
    match SALE_STATUSES.load(deps.storage, sale_id) {
        Ok(status) => Ok(SaleStatusResponse {
            id: sale_id.to_vec(),
            is_sealed: status.is_sealed,
            is_aborted: status.is_aborted,
        }),
        Err(_) => ContributorError::SaleStatusNotFound.std_err(),
    }
}

pub fn query_sale_times(deps: Deps, sale_id: &Binary) -> StdResult<SaleTimesResponse> {
    let sale_id = sale_id.as_slice();
    match SALE_TIMES.load(deps.storage, sale_id) {
        Ok(times) => Ok(SaleTimesResponse {
            id: sale_id.to_vec(),
            start: times.start,
            end: times.end,
        }),
        Err(_) => ContributorError::SaleTimesNotFound.std_err(),
    }
}

pub fn query_accepted_token(
    deps: Deps,
    sale_id: &Binary,
    token_index: u8,
) -> StdResult<AcceptedTokenResponse> {
    let sale_id = sale_id.as_slice();
    match load_accepted_token(deps.storage, sale_id, token_index) {
        Ok(token) => Ok(AcceptedTokenResponse {
            id: sale_id.to_vec(),
            token_index,
            chain: token.chain,
            address: token.address,
            conversion_rate: token.conversion_rate,
        }),
        Err(_) => ContributorError::AcceptedTokenNotFound.std_err(),
    }
}

pub fn query_total_contribution(
    deps: Deps,
    sale_id: &Binary,
    token_index: u8,
) -> StdResult<TotalContributionResponse> {
    let sale_id = sale_id.as_slice();
    match load_total_contribution(deps.storage, sale_id, token_index) {
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
    sale_id: &Binary,
    token_index: u8,
) -> StdResult<TotalAllocationResponse> {
    let sale_id = sale_id.as_slice();
    match load_total_allocation(deps.storage, sale_id, token_index) {
        Ok(amount) => Ok(TotalAllocationResponse {
            id: sale_id.to_vec(),
            token_index,
            amount,
        }),
        Err(_) => ContributorError::AllocationNotFound.std_err(),
    }
}
