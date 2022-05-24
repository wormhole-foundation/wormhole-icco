#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

/// ICCO non-Solana messages. VAA payloads (and Data payloads).
/// Not directly corresponding to accounts.
use core::convert::TryInto;
//use std::mem::size_of_val;

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    // program_error::ProgramError,
    pubkey::Pubkey,
};
use solitaire::*;

//use wormhole_sdk::{VAA};

use bridge::vaa::DeserializePayload;

/// -------------------------------------------------------------------
/// bytes -> numbers local Helper functions
fn read_u16(buf: &[u8]) -> u16 {
    u16::from_be_bytes(buf[0..2].try_into().unwrap())
}

fn read_u64(buf: &[u8]) -> u64 {
    u64::from_be_bytes(buf[0..8].try_into().unwrap())
}

fn read_u128(buf: &[u8]) -> u128 {
    u128::from_be_bytes(buf[0..16].try_into().unwrap())
}

fn read_u256(buf: &[u8]) -> (u128, u128) {
    (read_u128(&buf[0..]), read_u128(&buf[16..]))
}

/// -------------------------------------------------------------------
/// sale state is not VAA. It stores custody tottal amounts and other sale state data.
/// Sale state PDA struct:
/// 
///  sale_sealed: bool
///  sale_aborted: bool
/// [
///     token_total_cntribution: u64
///     token_cntribution_transferred: bool
/// ]

// sale_state size 
pub fn get_sale_state_size(token_cnt: u8) -> usize {
    2 + 9 * token_cnt as usize
}

// sale_state getters/setters
pub fn get_sale_state_sealed(bf: &[u8]) -> bool {
    bf[0] != 0
}
pub fn set_sale_state_sealed(bf: & mut [u8], v: bool) {
    bf[0] = if v {1} else {0};
}

pub fn get_sale_state_aborted(bf: &[u8]) -> bool {
    bf[1] != 0
}
pub fn set_sale_state_aborted(bf: & mut [u8], v: bool) {
    bf[1] = if v {1} else {0};
}

pub fn get_sale_state_contribution(bf: &[u8], token_idx: u8) -> u64 {
    read_u64(&bf[2 + 9 * (token_idx as usize)..])
}
pub fn set_sale_state_contribution(bf: & mut [u8], token_idx: u8, v: u64) {
    let n = (2 + 9 * token_idx) as usize;
    bf[n..n+8].clone_from_slice(&v.to_be_bytes()[..]);
}

pub fn get_sale_state_contribution_transferred(bf: &[u8], token_idx: u8) -> bool {
    bf[2+8 + 9 * (token_idx as usize)] != 0
}
pub fn set_sale_state_contribution_transferred(bf: & mut [u8], token_idx: u8, v: bool) {
    let n = (2+8 + 9 * (token_idx as usize)) as usize;
    bf[n] = if v {1} else {0};
}

/// -------------------------------------------------------------------
/// From VAA payload for SaleSealed.

// struct Allocation {
//     // Index in acceptedTokens array
//     uint8 tokenIndex;
//     // amount of sold tokens allocated to contributors on this chain
//     uint256 allocation;
//     // excess contributions refunded to contributors on this chain
//     uint256 excessContribution;
// }

// struct SaleSealed {
//     // PayloadID uint8 = 3
//     uint8 payloadID;
//     // Sale ID
//     uint256 saleID;
//     // allocations
//     Allocation[] allocations;
// }

#[derive(PartialEq, Debug)]
#[allow(non_snake_case)]
pub struct SaleSealed {
    pub payload_id: u8,     // 3
    pub sale_id: u128,
}

impl DeserializePayload for SaleSealed {
    // Only fixed portion can be deserialized.
    fn deserialize(buf: &mut &[u8]) -> Result<Self> {
        let r = SaleSealed {
            payload_id: buf[0],
            sale_id: read_u256(&buf[1..]).1,
        };
        Ok(r)
    }
}

///  get_sale_sealed_vaa_token_info ret: (idx, allocation, excessContribution)
pub fn get_sale_sealed_vaa_token_info(bf: & mut [u8], idx: u8) -> (u8, u128, u128) {    
    let step = 65 as usize;
    let base = (1+32+1) as usize + step * (idx as usize);
    (bf[base], read_u128(&bf[base + 1..]), read_u128(&bf[base + 33..]))
}


/// -------------------------------------------------------------------
/// From VAA payload for SaleAbort.
#[derive(PartialEq, Debug)]
#[allow(non_snake_case)]
pub struct SaleAbort {
    pub payload_id: u8,     // 4
    pub sale_id: u128,
}

impl DeserializePayload for SaleAbort {
    // Only fixed portion can be deserialized.
    fn deserialize(buf: &mut &[u8]) -> Result<Self> {
        let r = SaleAbort {
            payload_id: buf[0],
            sale_id: read_u256(&buf[1..]).1,
        };
        Ok(r)
    }
}


/// -------------------------------------------------------------------
/// Zero-copy from VAA payload for Init Sale.

// This portion is what we always want. deserialized by Solitaire
#[derive(PartialEq, Debug)]
#[allow(non_snake_case)]
pub struct InitSale {
    pub payload_id: u8,     // 1
    pub token_cnt: u8,
    pub sale_id: u128,
}

// Deserialize repeatedly needed data.
impl DeserializePayload for InitSale {
    // Only fixed portion can be deserialized.
    fn deserialize(buf: &mut &[u8]) -> Result<Self> {
        let r = InitSale {
            payload_id: buf[0],
            token_cnt: buf[228],
            sale_id: read_u256(&buf[1..]).1,
        };
        Ok(r)
    }
}
/*
/// Current encode from conductor for initSale VAA: 
    function encodeSaleInit(SaleInit memory saleInit) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(1),                   1b      0
            saleInit.saleID,            32b     1
            saleInit.tokenAddress,      32b     33
            saleInit.tokenChain,        2b      65
            saleInit.tokenDecimals      1b      67
            saleInit.tokenAmount,       32b     68
            saleInit.minRaise,          32b     100
            saleInit.maxRaise,          32b     132
            saleInit.saleStart,         32b     164
            saleInit.saleEnd,           32b     196
            encodeTokens(saleInit.acceptedTokens),  229 + 50*tCnt
            saleInit.recipient,         32b     229 + 50*tCnt
            saleInit.refundRecipient    32b     261 + 50*tCnt
        );
    }
    function encodeTokens(Token[] memory tokens) public pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(uint8(tokens.length));
        for (uint i = 0; i < tokens.length; i++) {
            encoded = abi.encodePacked(
                encoded,
                tokens[i].tokenAddress,     32b
                tokens[i].tokenChain,       2b
                tokens[i].conversionRate    16b
            );
        }
    }
*/

// Accessor methods to no-copy-read from slice directly.
impl InitSale {
    // This is used in wasm layer. Even though it looks redundand.
    pub fn get_init_sale_sale_id(bf: &[u8]) -> u128 {
         read_u256(&bf[1..]).1
    }

    // pub fn get_token_address(&self, bf: &[u8]) -> Pubkey {       // It is not valid Pubkey
    //     Pubkey::new(&bf[33..])
    // }
    pub fn get_token_address_bytes(bf: &[u8]) -> [u8; 32] {
        bf[33..65].try_into().unwrap()
    }

    pub fn get_token_chain(bf: &[u8]) -> u16 {
        read_u16(&bf[65..])
    }

    pub fn get_token_decimals(bf: &[u8]) -> u8 {
        bf[67]
    }

    pub fn get_token_amount(bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[68..])
    }

    pub fn get_min_raise(bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[100..])
    }

    pub fn get_max_raise(bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[132..])
    }

    pub fn get_sale_start(bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[164..])
    }

    pub fn get_sale_end(bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[196..])
    }

    pub fn get_solana_token_account_bytes(&self, bf: &[u8]) -> [u8; 32] {
        let offset: usize = 229 + usize::from(self.token_cnt) * 50;
        bf[offset..offset + 32].try_into().unwrap()
    }

    pub fn get_sale_recepient_bytes(&self, bf: &[u8]) -> [u8; 32] {
        let offset: usize = 261 + usize::from(self.token_cnt) * 50;
        bf[offset..offset + 32].try_into().unwrap()
    }

    pub fn get_refund_recepient_bytes(&self, bf: &[u8]) -> [u8; 32] {
        let offset: usize = 293 + usize::from(self.token_cnt) * 50;
        bf[offset..offset + 32].try_into().unwrap()
    }

    // Accepted tokens data getters
    // tokenAddress: Pubkey,
    pub fn get_accepted_token_address(idx: u8, bf: &[u8]) -> Pubkey {
        let t_offset: usize = 229 + (idx as usize) * 50;
        Pubkey::new(&bf[t_offset..t_offset + 32])
    }

    pub fn get_accepted_token_chain(idx: u8, bf: &[u8]) -> u16 {
        let t_offset: usize = 229 + (idx as usize) * 50 + 32;
        read_u16(&bf[t_offset..])
    }

    pub fn get_accepted_token_conversion_rate(idx: u8, bf: &[u8]) -> u128 {
        let t_offset: usize = 229 + (idx as usize) * 50 + 34;
        read_u128(&bf[t_offset..])
    }
}

/// -------------------------------------------------------------------
/// VAA saleAttested reply payload [2]

// Layout
// uint8 payloadID;    // PayloadID uint8 = 2
// uint256 saleID;     // Sale ID
// uint16 chainID;     // Chain ID
// uint8 tokens_cnt     // Contribution[] contributions; // sealed contributions for this sale
//      uint8 contributions[i].tokenIndex,
//      uint256 contributions[i].contributed

pub fn get_sale_attested_size(solana_tokens_cnt: u8) -> usize {
    (1+32+2+1) + (solana_tokens_cnt as usize)*(1+32) 
}

pub fn pack_sale_attested_vaa_header(bf: & mut [u8], sale_id: u128, solana_tokens_cnt: u8) {
    bf[0] = 2;
    bf[17..33].clone_from_slice(&sale_id.to_be_bytes()[..]);        // first 16 bytes s/b 0.
    bf[33..35].clone_from_slice(&(1 as u16).to_be_bytes()[..]);     // ChainId
    bf[35] = solana_tokens_cnt;
}

// token_idx - is index in initSale VAA
// slot_idx - is slot in the current sale attested message.
pub fn pack_sale_attested_vaa_token(bf: & mut [u8], token_idx: u8, slot_idx: u8, amount: u64) {
    let step = (1+32) as usize;
    let base = (1+32+2+1) as usize + step * (slot_idx as usize);
    bf[base] = token_idx;
    bf[base+1+24..].clone_from_slice(&amount.to_be_bytes()[..]);
}

// This may not be needed at all:
// pub fn get_sale_attested_vaa_token_info(bf: & mut [u8], slot_idx: u8) -> (u8, u64) {
//     let step = (1+32) as usize;
//     let base = (1+32+2+1) as usize + step * (slot_idx as usize);
//     (bf[base], read_u64(&bf[base + 1 + 24..]))
// }
