use anchor_lang::prelude::*;
use num_derive::*;

use crate::{constants::ACCEPTED_TOKENS_MAX, error::ContributorError, state::sale::AssetTotal};

#[account]
pub struct Buyer {
    //pub contributed: [u64; ACCEPTED_TOKENS_MAX], // 8 * ACCEPTED_TOKENS_MAX
    pub totals: Vec<BuyerTotal>, // 4 + BuyerTotal::MAXIMUM_SIZE * ACCEPTED_TOKENS_MAX
    //pub status: ContributionStatus,     // 1
    pub initialized: bool, // 1 (not sure for 1 bit)
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct BuyerTotal {
    pub contributions: u64,         // 8
    pub allocations: u64,           // 8
    pub excess_contributions: u64,  // 8
    pub status: ContributionStatus, // 1
}

impl BuyerTotal {
    pub const MAXIMUM_SIZE: usize = 8 + 8 + 8 + 1;
}

impl Buyer {
    pub const MAXIMUM_SIZE: usize = (4 + BuyerTotal::MAXIMUM_SIZE * ACCEPTED_TOKENS_MAX) + 1;

    pub fn initialize(&mut self, num_totals: usize) -> () {
        self.totals = vec![
            BuyerTotal {
                contributions: 0,
                allocations: 0,
                excess_contributions: 0,
                status: ContributionStatus::Inactive
            };
            num_totals
        ];
        self.initialized = true;
    }

    pub fn contribute(&mut self, idx: usize, amount: u64) -> Result<()> {
        require!(idx < self.totals.len(), ContributorError::InvalidTokenIndex);
        require!(!self.has_claimed(idx), ContributorError::BuyerDeactivated);

        let total = &mut self.totals[idx];
        total.contributions += amount;
        total.status = ContributionStatus::Active;
        Ok(())
    }

    // when a sale is sealed, we will now have information about
    // total allocations and excess contributions for each
    // token index
    /*
    pub fn claim_allocations(&mut self, totals: &Vec<AssetTotal>) -> Result<Vec<BuyerTotal>> {
        require!(self.is_active(), ContributorError::BuyerInactive);

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
        self.status = ContributionStatus::AllocationIsClaimed;
        Ok(buyer_totals)
    }
    */

    pub fn claim_refund(&mut self, idx: usize) -> Result<u64> {
        require!(!self.has_claimed(idx), ContributorError::BuyerDeactivated);

        let total = &mut self.totals[idx];
        total.excess_contributions = total.contributions;
        total.status = ContributionStatus::RefundIsClaimed;
        Ok(total.excess_contributions)
    }

    /*
    pub fn claim_refunds(&mut self, totals: &Vec<AssetTotal>) -> Result<Vec<BuyerTotal>> {
        require!(self.is_active(), ContributorError::BuyerInactive);

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

        self.status = ContributionStatus::RefundIsClaimed;
        Ok(refunds)
    }
    */

    /*
    fn is_active(&self) -> bool {
        self.initialized // && self.status == ContributionStatus::Active
    }*/

    fn has_claimed(&self, idx: usize) -> bool {
        let status = self.totals[idx].status;
        status == ContributionStatus::AllocationIsClaimed
            || status == ContributionStatus::RefundIsClaimed
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum ContributionStatus {
    Inactive = 0,
    Active,
    AllocationIsClaimed,
    RefundIsClaimed,
}
