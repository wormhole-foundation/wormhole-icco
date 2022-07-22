use anchor_lang::prelude::*;
use num_derive::*;

use crate::{constants::ACCEPTED_TOKENS_MAX, error::ContributorError, state::sale::AssetTotal};

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
/// Status of Buyer's contribution
pub enum ContributionStatus {
    /// Not initialized from `contribute` instruction
    Inactive = 0,
    /// Initialized from `contribute` instruction
    Active,
    /// For amount > 0, assigned after `claim_allocation` instruction
    ExcessClaimed,
    /// For amount > 0, assigned after `claim_refund` instruction
    RefundClaimed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
/// A record of `Buyer`'s allocation owed
pub struct BuyerAllocation {
    pub amount: u64,   // 8
    pub claimed: bool, // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
/// A record of a `Buyer`'s contributions and excess owed
pub struct BuyerContribution {
    /// Amount `Buyer` has contributed via `contribute` instruction.
    /// Borsh size: 8
    pub amount: u64,
    /// Amount `Buyer` is owed after `seal_sale` instruction. Computed
    /// at `claim_allocation` instruction.
    /// Borsh size: 8
    pub excess: u64,
    /// Status of `Buyer`'s contribution
    /// * Inactive
    /// * Active
    /// * ExcessClaimed
    /// * RefundClaimed
    /// Borsh size: 1
    pub status: ContributionStatus,
}

#[account]
/// `Buyer` stores the state of an individual contributor to a sale
pub struct Buyer {
    /// `Buyer` needs to keep track of a user's contribution amounts
    /// and excess after a sealed sale
    ///
    /// Borsh size: 4 + BuyerTotal::LENGTH * ACCEPTED_TOKENS_MAX
    pub contributions: Vec<BuyerContribution>,
    /// At the time of the `claim_allocation` instruction, we keep
    /// a record of how much allocation `amount` the `Buyer` is owed
    /// and whether it has been `claimed`
    ///
    /// Borsh size: BuyerAllocation::LENGTH
    pub allocation: BuyerAllocation,
    /// Check if the `Buyer` has been initialized (happens at `contribute`
    /// instruction)
    ///
    /// Borsh size: 1
    pub initialized: bool,
}

impl BuyerContribution {
    pub const LENGTH: usize = 8 + 8 + 1;
}

impl BuyerAllocation {
    pub const LENGTH: usize = 8 + 1;
}

impl Buyer {
    pub const MAXIMUM_SIZE: usize =
        (4 + BuyerContribution::LENGTH * ACCEPTED_TOKENS_MAX) + BuyerAllocation::LENGTH + 1;

    /// If a `Buyer` account hasn't been created yet, set up initial state
    ///
    /// # Arguments
    /// * `num_totals` - Size of accepted tokens found in `Sale` account
    ///
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

    /// At the `contribute` instruction, update the record of how much a
    /// `Buyer` has contributed for a given token index. Update status to
    /// `Active` after recording.
    ///
    /// # Arguments
    /// * `idx`    - Which element of `contributions` to update
    /// * `amount` - Amount to record in `contributions` element
    ///
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

    /// Returns amount owed to `Buyer` at the `claim_refunds` instruction.
    /// Update the record of how much a `Buyer` is owed for a given index of
    /// `contributions`. Update status to `RefundClaimed` after recording.
    /// The refund will equal the amount contributed from `contribute`
    /// instruction.
    ///
    /// # Arguments
    /// * `idx` - Which element of `contributions` to update
    ///
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

    /// Returns amount of allocation owed to `Buyer` at the `claim_allocation`
    /// instruction. Update the record of his allocation and set `claimed`
    /// to true.
    ///
    /// # Arguments
    /// * `sale_totals` - Taken from `Sale` after the sale has been sealed
    ///
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

    /// Returns amount of excess owed to `Buyer` at the `claim_allocation`
    /// instruction. Update the record of the excess contribution he made
    /// and set status to ExcessClaimed.
    ///
    /// # Arguments
    /// * `idx` - Which element of `contributions` to update
    /// * `total` - One `AssetTotal` element taken from `Sale` after the sale has been sealed
    ///
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

    /// Check whether a particular `contributions` index has been claimed
    fn has_claimed_index(&self, idx: usize) -> bool {
        let status = self.contributions[idx].status;
        status == ContributionStatus::ExcessClaimed || status == ContributionStatus::RefundClaimed
    }
}
