use anchor_lang::prelude::*;
use num_derive::*;

use crate::{state::config::ContributorConfig, wormhole::parse_vaa};

const INDEX_ACCEPTED_TOKENS_START: usize = 228;
const INDEX_ALLOCATIONS_START: usize = 33;
const ACCEPTED_TOKENS_N_BYTES: usize = 50;

// payloads
const PAYLOAD_SALE_INIT: u8 = 4;
const PAYLOAD_ATTEST_CONTRIBUTIONS: u8 = 2;
const PAYLOAD_SALE_SEALED: u8 = 3;
const PAYLOAD_SALE_ABORTED: u8 = 4;

#[error_code]
pub enum SaleError {
    #[msg("IncorrectVaaPayload")]
    IncorrectVaaPayload,

    #[msg("InvalidVaaAction")]
    InvalidVaaAction,

    #[msg("IncorrectSale")]
    IncorrectSale,
}

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

    pub fn initialize(&mut self, config: &ContributorConfig, signed_vaa: &[u8]) -> Result<()> {
        let parsed = parse_vaa(signed_vaa)?;
        config.verify_conductor(parsed.emitter_chain, parsed.emitter_address)?;

        // now deserialize payload
        let payload = parsed.payload;

        // check that the payload has at least the number of bytes
        // required to define the number of accepted tokens
        require!(
            payload.len() > INDEX_ACCEPTED_TOKENS_START,
            SaleError::IncorrectVaaPayload
        );

        // check that this is a SaleInit vaa (payload 1)
        require!(payload[0] == PAYLOAD_SALE_INIT, SaleError::InvalidVaaAction);

        self.num_accepted = payload[INDEX_ACCEPTED_TOKENS_START];

        // deserialize other things
        self.id = payload[1..33].try_into().unwrap();
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

        // TODO: we need to put the accepted tokens somewhere. we only care about solana-specific
        // tokens (i.e. chain id == 1). need PDAs for each token?

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
    }

    pub fn contribute(&mut self) -> Result<()> {
        Ok(())
    }

    pub fn attest_contributions(&mut self) -> Result<()> {
        Ok(())
    }

    pub fn seal(&mut self, config: &ContributorConfig, signed_vaa: &[u8]) -> Result<()> {
        let parsed = parse_vaa(signed_vaa)?;
        config.verify_conductor(parsed.emitter_chain, parsed.emitter_address)?;

        // now deserialize payload
        let payload = parsed.payload;

        // check that the payload has at least the number of bytes
        // required to define the number of allocations
        require!(
            payload.len() > INDEX_ALLOCATIONS_START,
            SaleError::IncorrectVaaPayload
        );

        // check that this is a SaleInit vaa (payload 1)
        require!(
            payload[0] == PAYLOAD_SALE_SEALED,
            SaleError::InvalidVaaAction
        );

        // deserialize other things
        let sale_id: [u8; 32] = payload[1..33].try_into().unwrap();
        require!(sale_id == self.id, SaleError::IncorrectSale);

        // TODO: we should have an index of which allocations we care about. we check
        // those and sum the allocations. These allocations are stored as uint256, so we
        // need to normalize these to u64 (native size of Solana spl tokens)
        let mut total_allocations = 0;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants

        // finally set the status to sealed
        self.status = SaleStatus::Sealed;

        Ok(())
    }

    pub fn claim_allocation(&mut self) -> Result<()> {
        Ok(())
    }

    pub fn abort(&mut self, config: &ContributorConfig, signed_vaa: &[u8]) -> Result<()> {
        let parsed = parse_vaa(signed_vaa)?;
        config.verify_conductor(parsed.emitter_chain, parsed.emitter_address)?;

        // now deserialize payload
        let payload = parsed.payload;

        // check that the payload has the correct size
        // payload type + sale id
        require!(payload.len() == 33, SaleError::IncorrectVaaPayload);

        // check that this is a SaleInit vaa (payload 1)
        require!(
            payload[0] == PAYLOAD_SALE_ABORTED,
            SaleError::InvalidVaaAction
        );

        // deserialize other things
        let sale_id: [u8; 32] = payload[1..33].try_into().unwrap();
        require!(sale_id == self.id, SaleError::IncorrectSale);

        // finally set the status to aborted
        self.status = SaleStatus::Aborted;

        Ok(())
    }

    pub fn claim_refund(&mut self) -> Result<()> {
        Ok(())
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
