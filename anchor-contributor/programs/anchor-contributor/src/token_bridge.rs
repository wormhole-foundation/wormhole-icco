use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

/**
 * Same as TransferNative & TransferWrapped Data.
 */
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct TransferData {
    pub nonce: u32,
    pub amount: u64,
    pub fee: u64,
    pub target_address: Pubkey,
    pub target_chain: u16,
}

pub const TRANSFER_WRAPPED_INSTRUCTION: u8 = 4; 
pub const TRANSFER_NATIVE_INSTRUCTION: u8 = 5;