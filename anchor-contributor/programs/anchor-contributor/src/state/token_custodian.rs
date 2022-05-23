use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct TokenCustodian {
    pub owner: Pubkey, // 32
}

impl TokenCustodian {
    pub const MAXIMUM_SIZE: usize = 32;
}
