use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Custodian {
    pub owner: Pubkey, // 32
}

impl Custodian {
    pub const MAXIMUM_SIZE: usize = 32;
}
