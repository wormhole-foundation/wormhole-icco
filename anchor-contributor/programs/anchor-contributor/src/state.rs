use anchor_lang::prelude::*;

use borsh::BorshDeserialize;
use num_derive::*;
use std::io::Write;

use crate::{
    constants::*,
    error::*,
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
    pub token_address: [u8; 32], // 32
    pub token_chain: u16,        // 2
    pub token_decimals: u8,      // 1
    pub times: SaleTimes,        // 8 + 8
    pub recipient: [u8; 32],     // 32
    pub num_accepted: u8,        // 1
    pub status: SaleStatus,      // 1

    // NOTE: we only care about our own (i.e. only look for chain == 1)
    //accepted_tokens: [AcceptedToken; ACCEPTED_TOKENS_MAX], // 256 * 33
    //totals: [AssetTotals; ACCEPTED_TOKENS_MAX],            // 256 * (8 * 3)

    pub id: [u8; 32], // 32
    pub bump: u8,     // 1
}

#[account]
pub struct AcceptedTokenPage{
    pub accepted_tokens: Vec<AcceptedToken>,
    pub totals: Vec<AssetTotal>
}

impl AcceptedTokenPage {
    pub fn add_token(&mut self, accepted_token:AcceptedToken, asset_total: AssetTotal){
        if self.accepted_tokens.len() < ACCEPTED_TOKENS_PER_PAGE as usize {
            self.accepted_tokens.push(accepted_token);
            self.totals.push(asset_total)
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct SaleTimes {
    start: u64,
    end: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,)]
pub enum SaleStatus {
    Active,
    Sealed,
    Aborted,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, PartialEq, Eq)]
pub struct AcceptedToken {
    pub index: u8,    // 1
    pub mint: Pubkey, // 32
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, PartialEq, Eq)]
pub struct AssetTotal {
    pub contributions: u64, //8
    pub allocations: u64,   //8
    pub excess_contributions: u64, //8
}

//256 * (AcceptedToken::MAXIMUM_SIZE + 8 * 3)
impl Sale {
    pub const MAXIMUM_SIZE: usize =
        32 + 2 + 1 + (8 + 8) + 32 + 1 + 1 + 32 + 1;
    pub fn parse_sale_init(&mut self, payload: &[u8]) -> Result<()> {
        // check that the payload has at least the number of bytes
        // required to define the number of accepted tokens
        require!(
            payload.len() > INDEX_ACCEPTED_TOKENS_START,
            SaleError::IncorrectVaaPayload
        );

        self.id = payload[1..33].try_into().unwrap();
        self.num_accepted = payload[INDEX_ACCEPTED_TOKENS_START];

        // deserialize other things
        self.token_address = payload[33..65].try_into().unwrap();
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

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
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

    pub fn get_num_accepted_tokens(&self) -> u8 {
        self.num_accepted
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

impl AcceptedToken {
    pub const MAXIMUM_SIZE: usize = 33;

    pub fn new(index: u8, token_address: &[u8]) -> Self {
        let mint = Pubkey::new(token_address);
        AcceptedToken { index, mint }
    }

    pub fn make_from_slice(index: u8, bytes: &[u8]) -> Option<Self> {
        // chain id starts at 32
        // we don't need the conversion rate for anything, so don't bother deserializing it
        match u16::from_be_bytes(bytes[32..34].try_into().unwrap()) {
            1u16 => Some(AcceptedToken::new(index, &bytes[0..32])),
            _ => None,
        }
    }
}