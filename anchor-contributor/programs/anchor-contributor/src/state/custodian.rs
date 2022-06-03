use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Custodian {
    pub owner: Pubkey, // 32
    pub nonce: u32,
}

impl Custodian {
    pub const MAXIMUM_SIZE: usize = 32 + 32 + 1;
}
