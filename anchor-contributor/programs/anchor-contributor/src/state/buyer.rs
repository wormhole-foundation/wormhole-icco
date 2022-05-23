use anchor_lang::prelude::*;
use num_derive::*;

use crate::{constants::ACCEPTED_TOKENS_MAX, error::BuyerError, state::sale::AssetTotal};

#[account]
pub struct Buyer {
    pub contributed: [u64; ACCEPTED_TOKENS_MAX], // 8 * ACCEPTED_TOKENS_MAX
    pub status: BuyerStatus,                     // 1
    pub initialized: bool,                       // 1 (not sure for 1 bit)

    pub bump: u8, // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct BuyerTotal {
    pub mint: Pubkey,              // 32
    pub allocations: u64,          // 8
    pub excess_contributions: u64, // 8
}

impl Buyer {
    pub const MAXIMUM_SIZE: usize = (8 * ACCEPTED_TOKENS_MAX) + 1 + 1 + 1;

    pub fn initialize(&mut self) -> () {
        self.initialized = true;
        self.status = BuyerStatus::Active;
    }

    pub fn contribute(&mut self, idx: usize, amount: u64) -> Result<()> {
        require!(self.is_active(), BuyerError::BuyerInactive);
        require!(idx < ACCEPTED_TOKENS_MAX, BuyerError::InvalidTokenIndex);
        self.contributed[idx] += amount;
        Ok(())
    }

    // when a sale is sealed, we will now have information about
    // total allocations and excess contributions for each
    // token index
    pub fn claim_allocations(&mut self, totals: &Vec<AssetTotal>) -> Result<Vec<BuyerTotal>> {
        require!(self.is_active(), BuyerError::BuyerInactive);

        let mut buyer_totals: Vec<BuyerTotal> = Vec::with_capacity(totals.len());
        for (i, asset) in totals.iter().enumerate() {
            let contributed = self.contributed[i];
            if contributed == 0 {
                continue;
            }

            let allocations = asset.allocations * contributed / asset.contributions;
            let excess_contributions =
                asset.excess_contributions * contributed / asset.contributions;

            buyer_totals.push(BuyerTotal {
                mint: asset.mint,
                allocations,
                excess_contributions,
            });
        }
        self.status = BuyerStatus::AllocationIsClaimed;
        Ok(buyer_totals)
    }

    pub fn claim_refunds(&mut self, totals: &Vec<AssetTotal>) -> Result<Vec<BuyerTotal>> {
        require!(self.is_active(), BuyerError::BuyerInactive);

        let mut refunds: Vec<BuyerTotal> = Vec::with_capacity(totals.len());
        for (i, asset) in totals.iter().enumerate() {
            let contributed = self.contributed[i];
            if contributed == 0 {
                continue;
            }

            refunds.push(BuyerTotal {
                mint: asset.mint,
                allocations: 0,
                excess_contributions: contributed,
            });
        }

        self.status = BuyerStatus::RefundIsClaimed;
        Ok(refunds)
    }

    fn is_active(&self) -> bool {
        self.initialized && self.status == BuyerStatus::Active
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum BuyerStatus {
    Active = 1,
    AllocationIsClaimed,
    RefundIsClaimed,
}
