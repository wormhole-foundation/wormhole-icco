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

fn read_u128(buf: &[u8]) -> u128 {
    u128::from_be_bytes(buf[0..16].try_into().unwrap())
}

fn read_u256(buf: &[u8]) -> (u128, u128) {
    (read_u128(&buf[0..]), read_u128(&buf[16..]))
}

/// -------------------------------------------------------------------
/// Zero-copy from VAA payload for Init Sale.

// This portion is what we always want. deserialized by Solitaire
#[derive(PartialEq, Debug)]
#[allow(non_snake_case)]
pub struct SaleInit {
    payload_id: u8, // Sale ID
    token_cnt: u8,
    pub sale_id: u128,
}

// Deserialize repeatedly need data.
impl DeserializePayload for SaleInit {
    // Only fixed portion can be deserialized.
    fn deserialize(buf: &mut &[u8]) -> Result<Self> {
        let r = SaleInit {
            payload_id: buf[0],
            token_cnt: buf[176],
            sale_id: read_u256(&buf[1..]).0,
        };
        Ok(r)
    }
}

// Accessor methods to no-copy-read from slice directly.
impl SaleInit {
    // This is used in wasm layer. Even though it looks redundand.
    pub fn get_init_sale_sale_id(bf: &[u8]) -> u128 {
         read_u256(&bf[1..]).0
    }

    pub fn get_token_address(&self, bf: &[u8]) -> Pubkey {
        Pubkey::new(&bf[33..])
    }

    pub fn get_token_chain(&self, bf: &[u8]) -> u16 {
        read_u16(&bf[65..])
    }

    pub fn get_token_amount(&self, bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[97..])
    }

    pub fn get_min_raise(&self, bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[129..])
    }

    pub fn get_max_raise(&self, bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[161..])
    }

    pub fn get_sale_start(&self, bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[193..])
    }

    pub fn get_sale_end(&self, bf: &[u8]) -> (u128, u128) {
        read_u256(&bf[225..])
    }

    pub fn get_sale_recepient(&self, bf: &[u8]) -> Pubkey {
        let recipient_offset: usize = 279 + usize::from(self.token_cnt) * 50;
        Pubkey::new(&bf[recipient_offset..recipient_offset + 32])
    }

    pub fn get_refund_recepient(&self, bf: &[u8]) -> Pubkey {
        let recipient_offset: usize = 279 + usize::from(self.token_cnt) * 50;
        Pubkey::new(&bf[recipient_offset + 32..recipient_offset + 64])
    }

    // Accepted tokens data getters
    // tokenAddress: Pubkey,
    pub fn get_accepted_token_address(&self, idx: usize, bf: &[u8]) -> Pubkey {
        let t_offset: usize = 279 + idx * 50;
        Pubkey::new(&bf[t_offset..t_offset + 32])
    }

    pub fn get_accepted_token_chain(&self, idx: usize, bf: &[u8]) -> u16 {
        let t_offset: usize = 279 + idx * 50 + 32;
        read_u16(&bf[t_offset..])
    }

    pub fn get_accepted_token_conversion_rate(&self, idx: usize, bf: &[u8]) -> (u128, u128) {
        let t_offset: usize = 279 + idx * 50 + 34;
        read_u256(&bf[t_offset..])
    }
}
