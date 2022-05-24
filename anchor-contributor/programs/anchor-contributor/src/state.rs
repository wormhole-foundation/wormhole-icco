use anchor_lang::prelude::*;
use crate::wormhole::*;
use num_derive::*;
use borsh::{BorshDeserialize};
use std::{
    io::Write,
};



#[account]
#[derive(Default)]
pub struct Contributor {
    pub owner: Pubkey,
    pub conductor_chain: u16,
    pub conductor_address: [u8; 32],
}

impl Contributor {
    pub const MAXIMUM_SIZE: usize = 2 + 32 + 32 + 1;

}

#[account]
pub struct Sale {
    token_address: Vec<u8>, // 32
    token_chain: u16,       // 2
    token_decimals: u8,     // 1
    times: SaleTimes,       // 8 + 8
    recipient: [u8; 32],    // 32
    num_accepted: u8,       // 1
    status: SaleStatus,     // 1

    pub id: Vec<u8>, // 32
    pub bump: u8,    // 1
}

impl Sale {
    pub const MAXIMUM_SIZE: usize = 32 + 32 + 2 + 1 + 8 + 8 + 32 + 1 + 1 + 1;
}

pub fn parse_sale_payload(payload: Vec<u8>){
    
}


#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct SaleTimes {
    start: u64,
    end: u64,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum SaleStatus {
    Active,
    Sealed,
    Aborted,
}
