use anchor_lang::prelude::*;

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

    pub id: Vec<u8>, // 32
    pub bump: u8,    // 1
}

impl Sale {
    pub const MAXIMUM_SIZE: usize = 32 + 2 + 1 + (8 + 8) + 32 + 1 + 1 + 32 + 1;

    pub fn parse_sale_init(&mut self, payload: &[u8]) -> Result<()> {
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

        // TODO: we need to put the accepted tokens somewhere. we only care about solana-specific
        // tokens (i.e. chain id == 1). need PDAs for each token?

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
    }

    /*
    pub fn parse_sale_sealed(
        &mut self,
        payload: &[u8],
    ) -> Result<()> {
        // check that the payload has at least the number of bytes
        // required to define the number of allocations
        require!(
            payload.len() > INDEX_ALLOCATIONS_START,
            SaleError::IncorrectVaaPayload
        );
        require!(sale_id == self.id, SaleError::IncorrectSale);

        // deserialize other things

        // TODO: we should have an index of which allocations we care about. we check
        // those and sum the allocations. These allocations are stored as uint256, so we
        // need to normalize these to u64 (native size of Solana spl tokens)
        let mut total_allocations = 0;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants

        // TODO: need to bridge collateral over to recipient

        // finally set the status to sealed
        self.status = SaleStatus::Sealed;

        Ok(())
    }

    pub fn claim_allocation(&mut self, contributor: &Contributor) -> Result<()> {
        // TODO: devs do something
        Ok(())
    }

    pub fn parse_sale_aborted(
        &mut self,
        contributor: &Contributor,
        sale_id: Vec<u8>,
        payload: &[u8],
    ) -> Result<()> {
        require!(!self.has_ended(), SaleError::SaleEnded);

        // check that the payload has the correct size
        // payload type + sale id
        require!(payload.len() == 33, SaleError::IncorrectVaaPayload);
        require!(sale_id == self.id, SaleError::IncorrectSale);

        // finally set the status to aborted
        self.status = SaleStatus::Aborted;

        Ok(())
    }
    */
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
