use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use cosmwasm_std::{Api, CanonicalAddr, DepsMut, StdError, StdResult, Uint128, Uint256};
use terraswap::asset::{Asset, AssetInfo};

use crate::byte_utils::ByteUtils;

// Chain ID of Terra
pub const CHAIN_ID: u16 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleTimes {
    pub start: u64,
    pub end: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleCore {
    pub id: Vec<u8>,
    pub token_address: Vec<u8>,
    pub token_chain: u16,
    pub token_amount: Uint256,
    pub min_raise: Uint256,
    pub max_raise: Uint256,
    pub times: SaleTimes,
    pub recipient: Vec<u8>,
    pub refund_recipient: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AcceptedToken {
    pub chain: u16,
    pub address: Vec<u8>,
    pub conversion_rate: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleStatus {
    pub is_sealed: bool,
    pub is_aborted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Contribution {
    pub token_index: u8,
    pub contributed: Uint256, // actually Uint128, but will be serialized as Uint256
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Allocation {
    pub token_index: u8,
    pub allocated: Uint256,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleInit {
    pub core: SaleCore,
    pub accepted_tokens: Vec<AcceptedToken>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ContributionsSealed {
    pub sale_id: Vec<u8>,
    pub chain_id: u16,
    pub contributions: Vec<Contribution>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleSealed {
    pub sale_id: Vec<u8>,
    pub allocations: Vec<Allocation>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SaleAborted {
    pub sale_id: Vec<u8>,
}

impl AcceptedToken {
    pub const N_BYTES: usize = 50;

    pub fn deserialize(data: &[u8]) -> StdResult<Self> {
        let address = data.get_bytes32(0).to_vec();
        if address.len() != 32 {
            return Err(StdError::generic_err("address.len() != 32"));
        }

        let chain = data.get_u16(32);
        let conversion_rate = data.get_u128_be(34);
        Ok(AcceptedToken {
            chain,
            address,
            conversion_rate: conversion_rate.into(),
        })
    }

    pub fn serialize(&self) -> Vec<u8> {
        [
            self.chain.to_be_bytes().to_vec(),
            self.address.to_vec(),
            self.conversion_rate.u128().to_be_bytes().to_vec(),
        ]
        .concat()
    }

    pub fn make_asset_info(&self, api: &dyn Api) -> StdResult<AssetInfo> {
        if self.chain != CHAIN_ID {
            return Err(StdError::generic_err("chain != terra"));
        }

        let addr = self.address.as_slice();
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

    pub fn make_asset(&self, api: &dyn Api, amount: Uint128) -> StdResult<Asset> {
        Ok(Asset {
            info: self.make_asset_info(api)?,
            amount: amount,
        })
    }
}

pub fn to_const_bytes32(data: &[u8], index: usize) -> [u8; 32] {
    data.get_bytes32(index).get_const_bytes(0)
}

pub fn to_u256(data: &[u8], index: usize) -> Uint256 {
    Uint256::new(to_const_bytes32(data, index))
}

impl SaleInit {
    pub const PAYLOAD_ID: u8 = 1;
    const INDEX_ACCEPTED_TOKENS_START: usize = 226;

    pub fn deserialize(data: &[u8]) -> StdResult<Self> {
        let sale_id = data.get_bytes32(0).to_vec();
        let token_address = data.get_bytes32(32).to_vec();
        let token_chain = data.get_u16(64);
        let token_amount = to_u256(data, 66);
        let min_raise = to_u256(data, 98);
        let max_raise = to_u256(data, 130);
        let start = data.get_u64(162 + 24); // encoded as u256, but we only care about u64 time
        let end = data.get_u64(194 + 24); // encoded as u256, but we only care about u64 for time

        let accepted_tokens =
            SaleInit::deserialize_tokens(&data[SaleInit::INDEX_ACCEPTED_TOKENS_START..])?;

        let index = SaleInit::INDEX_ACCEPTED_TOKENS_START
            + 1
            + AcceptedToken::N_BYTES * accepted_tokens.len();

        let recipient = data.get_bytes32(index).to_vec();
        let refund_recipient = data.get_bytes32(index + 32).to_vec();

        Ok(SaleInit {
            core: SaleCore {
                id: sale_id,
                token_address,
                token_chain,
                token_amount,
                min_raise,
                max_raise,
                times: SaleTimes { start, end },
                recipient,
                refund_recipient,
            },
            accepted_tokens,
        })
    }

    fn deserialize_tokens(data: &[u8]) -> StdResult<Vec<AcceptedToken>> {
        let n_tokens = data.get_u8(0) as usize;
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

impl ContributionsSealed {
    pub const PAYLOAD_ID: u8 = 2;

    pub fn new(sale_id: &[u8], chain_id: u16) -> Self {
        ContributionsSealed {
            sale_id: sale_id.to_vec(),
            chain_id,
            contributions: Vec::new(),
        }
    }

    pub fn add_contribution(&mut self, token_index: u8, contributed: Uint128) -> StdResult<usize> {
        // limit to len 255
        if self.contributions.len() >= 256 {
            return Err(StdError::generic_err("cannot exceed length 256"));
        }

        let contributed = Uint256::from(contributed.u128());
        self.contributions.push(Contribution {
            token_index,
            contributed,
        });
        Ok(self.contributions.len())
    }
    /*
    pub fn deserialize(data: &Vec<u8>) -> StdResult<Self> {
        let data = data.as_slice();
        let payload_id = data.get_u8(0);

        if payload_id != ContributionsSealed::PAYLOAD_ID {
            return Err(StdError::generic_err(
                "payload_id != ContributionsSealed::PAYLOAD_ID"
            ));
        }
        let sale_id = data.get_bytes32(1).to_vec();
        let chain_id = data.get_u16(33);

        // TODO: deserialize
        let contributions: Vec<Contribution> = Vec::new();
        Ok(ContributionsSealed {
            sale_id,
            chain_id,
            contributions,
        })
    }
    */
    pub fn serialize(&self) -> Vec<u8> {
        [
            ContributionsSealed::PAYLOAD_ID.to_be_bytes().to_vec(),
            self.sale_id.to_vec(),
            self.chain_id.to_be_bytes().to_vec(),
            self.serialize_contributions(),
        ]
        .concat()
    }

    fn serialize_contributions(&self) -> Vec<u8> {
        // TODO
        Vec::new()
    }
}

impl SaleSealed {
    pub const PAYLOAD_ID: u8 = 3;

    pub fn add_allocation(&mut self, token_index: u8, allocated: Uint256) -> StdResult<u8> {
        self.allocations.push(Allocation {
            token_index,
            allocated,
        });
        Ok(token_index)
    }
    pub fn deserialize(data: &[u8]) -> StdResult<Self> {
        let sale_id = data.get_bytes32(0).to_vec();

        let allocations = SaleSealed::deserialize_allocations(&data[32..]);
        Ok(SaleSealed {
            sale_id,
            allocations,
        })
    }

    pub fn deserialize_allocations(data: &[u8]) -> Vec<Allocation> {
        // TODO
        Vec::new()
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

impl SaleAborted {
    pub const PAYLOAD_ID: u8 = 4;

    pub fn deserialize(data: &[u8]) -> StdResult<Self> {
        Ok(SaleAborted {
            sale_id: data.get_bytes32(0).to_vec(),
        })
    }
    /*
    pub fn serialize(&self) -> Vec<u8> {
        [self.payload_id.to_be_bytes().to_vec(), self.sale_id.clone()].concat()
    }
    */
}
