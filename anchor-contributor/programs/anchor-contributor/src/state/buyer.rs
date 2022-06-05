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

    pub fn claim_refund(&mut self, idx: usize) -> Result<u64> {
        require!(
            !self.has_claimed_index(idx),
            ContributorError::AlreadyClaimed
        );

        let contribution = &mut self.contributions[idx];
        contribution.excess = contribution.amount;
        contribution.status = ContributionStatus::RefundClaimed;
        Ok(contribution.excess)
    }

    pub fn claim_allocation(&mut self, sale_totals: &Vec<AssetTotal>) -> Result<u64> {
        require!(!self.allocation.claimed, ContributorError::AlreadyClaimed);

        let total_allocation: u128 = sale_totals
            .iter()
            .zip(self.contributions.iter())
            .map(|(t, c)| match t.contributions {
                0 => 0,
                _ => t.allocations as u128 * c.amount as u128 / t.contributions as u128,
            })
            .sum();

        require!(
            total_allocation < u64::MAX as u128,
            ContributorError::AmountTooLarge
        );
        self.allocation.amount = total_allocation as u64;
        self.allocation.claimed = true;
        Ok(self.allocation.amount)
    }

    pub fn claim_excess(&mut self, idx: usize, total: &AssetTotal) -> Result<u64> {
        require!(
            !self.has_claimed_index(idx),
            ContributorError::AlreadyClaimed
        );
        let excess_contribution = match total.contributions {
            0 => 0,
            _ => {
                let contribution = &self.contributions[idx];
                total.excess_contributions as u128 * contribution.amount as u128
                    / total.contributions as u128
            }
        };
        require!(
            excess_contribution < u64::MAX as u128,
            ContributorError::AmountTooLarge
        );
        let contribution = &mut self.contributions[idx];
        contribution.excess = excess_contribution as u64;
        contribution.status = ContributionStatus::ExcessClaimed;
        Ok(contribution.excess)
    }

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
