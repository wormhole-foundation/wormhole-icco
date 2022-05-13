use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use cosmwasm_std::{Api, CanonicalAddr, StdError, StdResult, Uint128, Uint256};
use terraswap::asset::AssetInfo;

use crate::{byte_utils::ByteUtils, error::CommonError};

// Chain ID of Terra
pub const CHAIN_ID: u16 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleTimes {
    pub start: u64,
    pub end: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleCore {
    pub token_address: Vec<u8>,
    pub token_chain: u16,
    pub token_decimals: u8,
    pub token_amount: Uint256,
    pub min_raise: Uint256,
    pub max_raise: Uint256,
    pub times: SaleTimes,
    pub recipient: Vec<u8>,
    pub refund_recipient: Vec<u8>,
    pub num_accepted: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AcceptedToken {
    pub chain: u16,
    pub address: Vec<u8>,
    pub conversion_rate: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum SaleStatus {
    Active,
    Sealed,
    Aborted,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Contribution {
    pub token_index: u8,
    pub amount: Uint256, // actually Uint128, but will be serialized as Uint256
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Allocation {
    pub allocated: Uint256,
    pub excess_contributed: Uint256,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AssetAllocation {
    pub allocated: Uint128,
    pub excess_contributed: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleInit<'a> {
    pub id: &'a [u8],
    pub core: SaleCore,
    pub accepted_tokens: Vec<AcceptedToken>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ContributionsSealed<'a> {
    pub id: &'a [u8],
    pub chain_id: u16,
    pub contributions: Vec<Contribution>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleSealed<'a> {
    pub id: &'a [u8],
    pub allocations: Vec<Allocation>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleAborted<'a> {
    pub id: &'a [u8],
}

impl SaleCore {
    pub fn adjust_token_amount(&self, amount: Uint256, decimals: u8) -> StdResult<Uint128> {
        let adjusted: Uint256;
        if self.token_decimals > decimals {
            let x = self.token_decimals - decimals;
            adjusted = amount / Uint256::from(10u128).pow(x as u32);
        } else {
            let x = decimals - self.token_decimals;
            adjusted = amount * Uint256::from(10u128).pow(x as u32);
        }

        match to_uint128(adjusted) {
            Some(value) => return Ok(value),
            None => return CommonError::AmountExceedsUint128Max.std_err(),
        }
    }
}

impl AcceptedToken {
    pub const N_BYTES: usize = 50;

    // conversion rate isn't used by the contributor for anything, so will
    // avoid deserializing
    pub fn deserialize(data: &[u8]) -> StdResult<Self> {
        let address = data.get_bytes32(0).to_vec();
        if address.len() != 32 {
            return Err(StdError::generic_err("address.len() != 32"));
        }

        let chain = data.get_u16(32);
        // let conversion_rate = data.get_u128_be(34);
        Ok(AcceptedToken {
            chain,
            address,
            // conversion_rate: conversion_rate.into(),
            conversion_rate: Uint128::zero(),
        })
    }
}

impl Contribution {
    pub const NUM_BYTES: usize = 33; // 1 + 32
}

impl Allocation {
    pub const NUM_BYTES: usize = 65; // 1 + 32 + 32
}

impl<'a> SaleInit<'a> {
    pub const PAYLOAD_ID: u8 = 1;
    const INDEX_ACCEPTED_TOKENS_START: usize = 228;

    pub fn get_sale_id(data: &'a [u8]) -> StdResult<&[u8]> {
        match data[0] {
            SaleInit::PAYLOAD_ID => Ok(&data[1..33]),
            _ => CommonError::InvalidVaaAction.std_err(),
        }
    }

    // TODO: replicate deserialize_safely like in SaleSealed
    pub fn deserialize(id: &'a [u8], data: &'a [u8]) -> StdResult<Self> {
        let token_address = data.get_bytes32(33).to_vec();
        let token_chain = data.get_u16(65);
        let token_decimals = data[67]; // TODO: double-check this is correct
        let token_amount = to_u256(data, 68);
        let min_raise = to_u256(data, 100);
        let max_raise = to_u256(data, 132);
        let start = data.get_u64(164 + 24); // encoded as u256, but we only care about u64 time
        let end = data.get_u64(196 + 24); // encoded as u256, but we only care about u64 for time

        let accepted_tokens =
            SaleInit::deserialize_tokens(&data[SaleInit::INDEX_ACCEPTED_TOKENS_START..])?;
        let num_accepted = accepted_tokens.len();

        let index =
            SaleInit::INDEX_ACCEPTED_TOKENS_START + 1 + AcceptedToken::N_BYTES * num_accepted;

        let recipient = data.get_bytes32(index).to_vec();
        let refund_recipient = data.get_bytes32(index + 32).to_vec();

        Ok(SaleInit {
            id,
            core: SaleCore {
                token_address,
                token_chain,
                token_decimals,
                token_amount,
                min_raise,
                max_raise,
                times: SaleTimes { start, end },
                recipient,
                refund_recipient,
                num_accepted: num_accepted as u8,
            },
            accepted_tokens,
        })
    }

    fn deserialize_tokens(data: &[u8]) -> StdResult<Vec<AcceptedToken>> {
        let n_tokens = data[0] as usize;
        let expected_length = 1 + AcceptedToken::N_BYTES * n_tokens;
        if data.len() <= expected_length {
            return Err(StdError::generic_err("data.len() < expected_length"));
        }

        let mut tokens: Vec<AcceptedToken> = Vec::with_capacity(n_tokens);
        for i in 0..n_tokens {
            let start = 1 + AcceptedToken::N_BYTES * i;
            let end = 1 + AcceptedToken::N_BYTES * (i + 1);
            tokens.push(AcceptedToken::deserialize(&data[start..end])?);
        }
        Ok(tokens)
    }
}

impl<'a> ContributionsSealed<'a> {
    pub const PAYLOAD_ID: u8 = 2;
    pub const HEADER_LEN: usize = 34;

    pub fn new(sale_id: &'a [u8], chain_id: u16, capacity: usize) -> Self {
        ContributionsSealed {
            id: sale_id,
            chain_id,
            contributions: Vec::with_capacity(capacity),
        }
    }

    pub fn add_contribution(&mut self, token_index: u8, amount: Uint128) -> StdResult<()> {
        let contributions = &mut self.contributions;

        // limit to len 256
        if contributions.len() >= 256 {
            return Err(StdError::generic_err("cannot exceed length 256"));
        }

        if let Some(_) = contributions.iter().find(|c| c.token_index == token_index) {
            return Err(StdError::generic_err(
                "token_index already in contributions",
            ));
        }

        contributions.push(Contribution {
            token_index,
            amount: amount.into(),
        });
        Ok(())
    }

    pub fn serialize(&self) -> Vec<u8> {
        let contributions = &self.contributions;
        let mut serialized = Vec::with_capacity(
            1 + ContributionsSealed::HEADER_LEN + Contribution::NUM_BYTES * contributions.len(),
        );
        serialized.push(ContributionsSealed::PAYLOAD_ID);
        serialized.extend_from_slice(self.id);
        serialized.extend(self.chain_id.to_be_bytes().iter());
        for contribution in contributions {
            serialized.push(contribution.token_index);
            serialized.extend(contribution.amount.to_be_bytes().iter());
        }
        serialized
    }
}

impl<'a> SaleSealed<'a> {
    pub const PAYLOAD_ID: u8 = 3;
    pub const HEADER_LEN: usize = 34;

    pub fn new(id: &'a [u8], num_allocations: usize) -> Self {
        let mut allocations: Vec<Allocation> = Vec::with_capacity(num_allocations);
        for _ in 0..num_allocations {
            allocations.push(Allocation {
                allocated: Uint256::zero(),
                excess_contributed: Uint256::zero(),
            });
        }

        SaleSealed { id, allocations }
    }

    pub fn add_allocation(
        &mut self,
        token_index: u8,
        allocated: Uint128,
        excess_contributed: Uint128,
    ) -> StdResult<()> {
        let allocation = &mut self.allocations[token_index as usize];

        allocation.allocated = allocated.into();
        allocation.excess_contributed = excess_contributed.into();
        Ok(())
    }

    pub fn get_sale_id(data: &'a [u8]) -> StdResult<&[u8]> {
        match data[0] {
            SaleSealed::PAYLOAD_ID => Ok(&data[1..33]),
            _ => CommonError::InvalidVaaAction.std_err(),
        }
    }

    pub fn deserialize_allocations_safely(
        data: &[u8],
        expected_num_allocations: u8,
        indices: &Vec<u8>,
    ) -> StdResult<Vec<(u8, Allocation)>> {
        if data[33] != expected_num_allocations {
            return Err(StdError::generic_err("encoded num_allocations != expected"));
        }

        let mut parsed: Vec<(u8, Allocation)> = Vec::with_capacity(indices.len());
        for &token_index in indices {
            let i = SaleSealed::HEADER_LEN + (token_index as usize) * Allocation::NUM_BYTES;
            parsed.push((
                token_index,
                Allocation {
                    allocated: to_u256(data, i + 1),
                    excess_contributed: to_u256(data, i + 33),
                },
            ));
        }

        Ok(parsed)
    }
    /*
    pub fn serialize(&self) -> Vec<u8> {
        [
            SaleSealed::PAYLOAD_IDto_be_bytes().to_vec(),
            self.sale_id.clone(),
            // TODO: serialize allocations
        ]
        .concat()
    }
    */
}

impl<'a> SaleAborted<'a> {
    pub const PAYLOAD_ID: u8 = 4;

    pub fn get_sale_id(data: &'a [u8]) -> StdResult<&[u8]> {
        match data[0] {
            SaleAborted::PAYLOAD_ID => Ok(&data[1..33]),
            _ => CommonError::InvalidVaaAction.std_err(),
        }
    }
    /*
    pub fn serialize(&self) -> Vec<u8> {
        [self.payload_id.to_be_bytes().to_vec(), self.sale_id.clone()].concat()
    }
    */
}

fn to_const_bytes32(data: &[u8], index: usize) -> [u8; 32] {
    data.get_bytes32(index).get_const_bytes(0)
}

fn to_u256(data: &[u8], index: usize) -> Uint256 {
    Uint256::new(to_const_bytes32(data, index))
}

pub fn make_asset_info(api: &dyn Api, addr: &[u8]) -> StdResult<AssetInfo> {
    match addr[0] {
        1u8 => {
            // match first "u" (e.g. uusd)
            match addr.iter().position(|&x| x == 117u8) {
                Some(idx) => {
                    let denom = &addr[idx..32];
                    match String::from_utf8(denom.into()) {
                        Ok(denom) => Ok(AssetInfo::NativeToken { denom }),
                        _ => Err(StdError::generic_err("not valid denom")),
                    }
                }
                None => Err(StdError::generic_err("not valid denom")),
            }
        }
        _ => {
            let token_address = CanonicalAddr::from(&addr[12..32]);
            let humanized = api.addr_humanize(&token_address)?;
            Ok(AssetInfo::Token {
                contract_addr: humanized.to_string(),
            })
        }
    }
}

pub fn to_uint128(value: Uint256) -> Option<Uint128> {
    if value > Uint256::from(u128::MAX) {
        return None;
    }

    let bytes = value.to_be_bytes();
    let (_, value) = bytes.as_slice().get_u256(0);
    Some(value.into())
}
