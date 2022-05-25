use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;

use borsh::BorshDeserialize;
use num_derive::*;
use std::io::Write;

use crate::{
    constants::{ACCEPTED_TOKENS_N_BYTES, INDEX_ACCEPTED_TOKENS_START, INDEX_ALLOCATIONS_START},
    error::SaleError,
};

#[account]
#[derive(Default)]
pub struct Contributor {
    pub owner: Pubkey,               // 32
    pub conductor_chain: u16,        // 2
    pub conductor_address: [u8; 32], // 32
}

impl Contributor {
    pub const MAXIMUM_SIZE: usize = 32 + 2 + 32;
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct AcceptedToken {
    pub index: u8,    // 1
    pub mint: Pubkey, // 32
    pub ata: Pubkey,  // 32
}

impl AcceptedToken {
    pub const MAXIMUM_SIZE: usize = 65;

    pub fn new(index: u8, token_address: &[u8], contributor: &Pubkey) -> Self {
        let mint = Pubkey::new(token_address);
        AcceptedToken {
            index,
            mint,
            ata: get_associated_token_address(contributor, &mint),
        }
    }

    pub fn make_from_slice(index: u8, bytes: &[u8], contributor: &Pubkey) -> Option<Self> {
        // chain id starts at 32
        // we don't need the conversion rate for anything, so don't bother deserializing it
        match u16::from_be_bytes(bytes[32..34].try_into().unwrap()) {
            1u16 => Some(AcceptedToken::new(index, &bytes[0..32], contributor)),
            _ => None,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct AssetTotals {
    pub contributions: u64,
    pub allocations: u64,
    pub excess_contributions: u64,
}

#[account]
pub struct Sale {
    // TODO: I don't think we need the token address if we are passing
    // the sale token ATA info in the sale init vaa. Is this true?
    token_address: Vec<u8>, // 32
    token_chain: u16,       // 2
    token_decimals: u8,     // 1
    times: SaleTimes,       // 8 + 8
    recipient: [u8; 32],    // 32
    num_accepted: u8,       // 1
    status: SaleStatus,     // 1

    // NOTE: we only care about our own (i.e. only look for chain == 1)
    accepted_tokens: Vec<AcceptedToken>, // up to 256 * 65
    totals: Vec<AssetTotals>,            // up to 256 * (8 * 3)

    pub id: Vec<u8>, // 32
    pub bump: u8,    // 1
}

impl Sale {
    pub const MAXIMUM_SIZE: usize =
        32 + 2 + 1 + (8 + 8) + 32 + 1 + 1 + 128 * (AcceptedToken::MAXIMUM_SIZE + 8 * 3) + 32 + 1;
        
    pub fn parse_sale_init(&mut self, payload: &[u8], contributor: &Pubkey) -> Result<()> {
        // check that the payload has at least the number of bytes
        // required to define the number of accepted tokens
        require!(
            payload.len() > INDEX_ACCEPTED_TOKENS_START,
            SaleError::IncorrectVaaPayload
        );

        self.id = payload[1..33].into();
        self.num_accepted = payload[INDEX_ACCEPTED_TOKENS_START];

        // deserialize other things
        self.token_address = payload[33..65].into();
        self.token_chain = u16::from_be_bytes(payload[65..67].try_into().unwrap());
        self.token_decimals = payload[67];

        // assume these times are actually u64... these are stored as uint256 in evm
        self.times.start = u64::from_be_bytes(payload[164 + 24..164 + 32].try_into().unwrap());
        self.times.end = u64::from_be_bytes(payload[196 + 24..196 + 32].try_into().unwrap());

        // because the accepted tokens are packed in before the recipient... we need to find
        // where this guy is based on how many accepted tokens there are. yes, we hate this, too
        let idx = INDEX_ACCEPTED_TOKENS_START
            + 1
            + ACCEPTED_TOKENS_N_BYTES * (self.num_accepted as usize);
        self.recipient = payload[idx..idx + 32]
            .try_into()
            .expect("incorrect bytes length");

        // We need to put the accepted tokens somewhere. we only care about solana-specific
        // tokens. Will create ATAs afterwards outside of parsing sale init
        self.accepted_tokens = Vec::with_capacity(self.num_accepted as usize);
        self.totals = Vec::with_capacity(self.num_accepted as usize);
        for index in 0..self.num_accepted {
            let start =
                INDEX_ACCEPTED_TOKENS_START + 1 + (index as usize) * ACCEPTED_TOKENS_N_BYTES;
            if let Some(token) = AcceptedToken::make_from_slice(
                index,
                &payload[start..start + ACCEPTED_TOKENS_N_BYTES],
                &contributor,
            ) {
                self.accepted_tokens.push(token);
                self.totals.push(AssetTotals {
                    contributions: 0,
                    allocations: 0,
                    excess_contributions: 0,
                });
            }
        }

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
    }

    pub fn update_total_contributions(
        &mut self,
        token_index: u8,
        contributed: u64,
    ) -> Result<usize> {
        let idx = try_find_index(&self.accepted_tokens, token_index)?;
        self.totals[idx].contributions += contributed;
        Ok(idx)
    }

    pub fn parse_sale_sealed(&mut self, payload: &[u8]) -> Result<()> {
        // check that the payload has at least the number of bytes
        // required to define the number of allocations
        require!(
            payload.len() > INDEX_ALLOCATIONS_START,
            SaleError::IncorrectVaaPayload
        );
        require!(Sale::get_id(payload) == self.id, SaleError::IncorrectSale);

        // deserialize other things

        // TODO: we should have an index of which allocations we care about. we check
        // those and sum the allocations. These allocations are stored as uint256, so we
        // need to normalize these to u64 (native size of Solana spl tokens)
        let grand_total_allocations: u64 = 0;

        // TODO: when we deserialize, push to self.total_allocations and self.total_excess_contributions

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants

        // TODO: need to bridge collateral over to recipient (total_collateral minus excess_collateral)

        // finally set the status to sealed
        self.status = SaleStatus::Sealed;

        Ok(())
    }

    pub fn parse_sale_aborted(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.has_ended(), SaleError::SaleEnded);

        // check that the payload has the correct size
        // payload type + sale id
        require!(payload.len() == 33, SaleError::IncorrectVaaPayload);
        require!(Sale::get_id(payload) == self.id, SaleError::IncorrectSale);

        // finally set the status to aborted
        self.status = SaleStatus::Aborted;

        Ok(())
    }

    pub fn get_num_accepted_tokens(&self) -> usize {
        self.accepted_tokens.len()
    }

    pub fn get_accepted_tokens(&self) -> &Vec<AcceptedToken> {
        &self.accepted_tokens
    }

    pub fn get_accepted_token_index(&self, token_index: u8) -> Result<usize> {
        let result = self
            .accepted_tokens
            .iter()
            .position(|token| token.index == token_index);
        require!(result != None, SaleError::InvalidTokenIndex);

        Ok(result.unwrap())
    }

    pub fn get_totals(&self, token_index: u8) -> Result<&AssetTotals> {
        try_index_at(&self.accepted_tokens, &self.totals, token_index)
    }

    pub fn is_active(&self, time: u64) -> bool {
        return self.status == SaleStatus::Active
            && time >= self.times.start
            && time <= self.times.end;
    }

    pub fn has_ended(&self) -> bool {
        return self.status == SaleStatus::Sealed || self.status == SaleStatus::Aborted;
    }

    pub fn is_sealed(&self) -> bool {
        return self.status == SaleStatus::Sealed;
    }

    pub fn is_aborted(&self) -> bool {
        return self.status == SaleStatus::Aborted;
    }

    fn get_id(payload: &[u8]) -> Vec<u8> {
        payload[1..33].into()
    }
}

// NOTE: see above defined in the Sale struct
//pub fn parse_sale_payload(payload: Vec<u8>) {}

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

#[account]
pub struct Buyer {
    contributed: Vec<u64>, // 8 * 256
    status: BuyerStatus,   // 1

    pub bump: u8, // 1
}

impl Buyer {
    const MAXIMUM_SIZE: usize = 8 * 256 + 1 + 1;

    pub fn new(&mut self, n_reserve: usize) -> Result<()> {
        self.contributed = Vec::with_capacity(n_reserve);
        self.status = BuyerStatus::Active;
        Ok(())
    }

    pub fn contribute(&mut self, idx: usize, amount: u64) -> Result<()> {
        self.contributed[idx] += amount;
        Ok(())
    }

    // when a sale is sealed, we will now have information about
    // total allocations and excess contributions for each
    // token index
    pub fn claim_allocation(
        &mut self,
        idx: u8,
        total_contributions: u64,
        total_allocations: u64,
        total_excess: u64,
    ) -> Result<(u64, u64)> {
        require!(self.is_active(), SaleError::BuyerNotActive);

        let contributed = self.contributed[idx as usize];
        self.status = BuyerStatus::AllocationIsClaimed;
        Ok((
            total_allocations * contributed / total_contributions,
            total_excess * contributed / total_contributions,
        ))
    }

    pub fn claim_refund(&mut self, idx: u8) -> Result<u64> {
        require!(self.is_active(), SaleError::BuyerNotActive);

        self.status = BuyerStatus::RefundIsClaimed;
        Ok(self.contributed[idx as usize])
    }

    fn is_active(&self) -> bool {
        self.status == BuyerStatus::Active
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum BuyerStatus {
    Active,
    AllocationIsClaimed,
    RefundIsClaimed,
}

/*
    pub fn update_total_contributions(&mut self, idx: usize, contributed: u64) -> Result<()> {
        let result = self.totals.get_mut(idx);
        require!(result != None, SaleError::InvalidAcceptedIndex);
*/

fn try_find_index(accepted_tokens: &Vec<AcceptedToken>, token_index: u8) -> Result<usize> {
    let result = accepted_tokens
        .iter()
        .position(|token| token.index == token_index);
    require!(result != None, SaleError::InvalidTokenIndex);
    Ok(result.unwrap())
}

fn try_index_at<'a, T: PartialEq>(
    accepted_tokens: &Vec<AcceptedToken>,
    items: &'a Vec<T>,
    token_index: u8,
) -> Result<&'a T> {
    require!(
        accepted_tokens.len() == items.len(),
        SaleError::InvalidTokenIndex
    );
    Ok(items
        .get(try_find_index(accepted_tokens, token_index)?)
        .unwrap())
}

fn mut_try_index_at<'a, T: PartialEq>(
    accepted_tokens: &Vec<AcceptedToken>,
    items: &'a mut Vec<T>,
    token_index: u8,
) -> Result<&'a T> {
    require!(
        accepted_tokens.len() == items.len(),
        SaleError::InvalidTokenIndex
    );
    Ok(items
        .get(try_find_index(accepted_tokens, token_index)?)
        .unwrap())
}
