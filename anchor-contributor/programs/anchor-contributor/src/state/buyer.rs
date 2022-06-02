use anchor_lang::prelude::*;
use num_derive::*;

use crate::{constants::ACCEPTED_TOKENS_MAX, error::ContributorError, state::sale::AssetTotal};

#[account]
pub struct Buyer {
    pub contributions: Vec<BuyerContribution>, // 4 + BuyerTotal::LENGTH * ACCEPTED_TOKENS_MAX
    pub allocation: BuyerAllocation,           // BuyerAllocation::LENGTH
    pub initialized: bool,                     // 1 (not sure for 1 bit)
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct BuyerContribution {
    pub amount: u64,                // 8
    pub excess: u64,                // 8
    pub status: ContributionStatus, // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct BuyerAllocation {
    pub amount: u64,   // 8
    pub claimed: bool, // 1
}

impl BuyerContribution {
    pub const LENGTH: usize = 8 + 8 + 8 + 1;
}

impl BuyerAllocation {
    pub const LENGTH: usize = 8 + 1;
}

impl Buyer {
    pub const MAXIMUM_SIZE: usize =
        (4 + BuyerContribution::LENGTH * ACCEPTED_TOKENS_MAX) + BuyerAllocation::LENGTH + 1;

    pub fn initialize(&mut self, num_totals: usize) -> () {
        self.contributions = vec![
            BuyerContribution {
                amount: 0,
                excess: 0,
                status: ContributionStatus::Inactive
            };
            num_totals
        ];
        self.allocation.amount = 0;
        self.allocation.claimed = false;
        self.initialized = true;
    }

    pub fn contribute(&mut self, idx: usize, amount: u64) -> Result<()> {
        require!(
            idx < self.contributions.len(),
            ContributorError::InvalidTokenIndex
        );
        require!(
            !self.has_claimed_index(idx),
            ContributorError::ContributeDeactivated
        );

        let total = &mut self.contributions[idx];
        total.amount += amount;
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
        require!(
            !self.has_claimed_index(idx),
            ContributorError::AlreadyClaimed
        );

        let total = &mut self.contributions[idx];
        total.excess = total.amount;
        total.status = ContributionStatus::RefundClaimed;
        Ok(total.excess)
    }

    pub fn claim_allocation(&mut self, sale_totals: &Vec<AssetTotal>) -> Result<u64> {
        require!(!self.allocation.claimed, ContributorError::AlreadyClaimed);

        let total_allocation: u128 = sale_totals
            .iter()
            .zip(self.contributions.iter())
            .map(|(t, c)| t.allocations as u128 * c.amount as u128 / t.contributions as u128)
            .sum();

        require!(
            total_allocation < u64::MAX as u128,
            ContributorError::AmountTooLarge
        );
        self.allocation.amount = total_allocation as u64;
        self.allocation.claimed = true;
        Ok(self.allocation.amount)
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

    fn has_claimed_index(&self, idx: usize) -> bool {
        let status = self.contributions[idx].status;
        status == ContributionStatus::ExcessClaimed || status == ContributionStatus::RefundClaimed
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum ContributionStatus {
    Inactive = 0,
    Active,
    ExcessClaimed,
    RefundClaimed,
}
