use anchor_lang::prelude::*;
use num_derive::*;
use num_traits::*;

#[account]
pub struct Sale {
    id: [u8; 32],            // 32
    token_address: [u8; 32], // 32
    token_chain: u16,        // 2
    token_decimals: u8,      // 1
    times: SaleTimes,        // 8 + 8
    recipient: [u8; 32],     // 32
    num_accepted: u8,        // 1
    status: SaleStatus,      // 1
}

impl Sale {
    pub const MAXIMUM_SIZE: usize = 32 + 32 + 2 + 1 + 8 + 8 + 32 + 1 + 1;

    // TODO: needs message_key generated from post vaa to check if claimed (not sure how this works yet)
    pub fn start(&mut self, message_key: Pubkey, signed_vaa: Vec<u8>) -> Result<()> {
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        return self.status == SaleStatus::Active;
    }
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
