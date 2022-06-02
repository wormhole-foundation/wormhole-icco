use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use num::bigint::BigUint;
use num_derive::*;
use std::{str::FromStr, u64};

use crate::{
    constants::*,
    env::*,
    error::SaleError,
    wormhole::{get_message_data, MessageData},
};

#[account]
#[derive(Debug)]
pub struct Sale {
    pub custodian: Pubkey,                     // 32
    pub id: [u8; 32],                          // 32
    pub associated_sale_token_address: Pubkey, // 32
    pub token_chain: u16,                      // 2
    pub token_decimals: u8,                    // 1
    pub times: SaleTimes,                      // 8 + 8
    pub recipient: [u8; 32],                   // 32
    pub status: SaleStatus,                    // 1
    pub initialized: bool,                     // 1

    pub totals: Vec<AssetTotal>, // 4 + AssetTotal::MAXIMUM_SIZE * ACCEPTED_TOKENS_MAX
    pub native_token_decimals: u8, // 1

    pub bump: u8, // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq, Debug)]
pub struct SaleTimes {
    pub start: u64,
    pub end: u64,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    FromPrimitive,
    ToPrimitive,
    Copy,
    Clone,
    PartialEq,
    Eq,
    Debug,
)]
pub enum SaleStatus {
    Active,
    Sealed,
    Aborted,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct AssetTotal {
    pub token_index: u8,           // 1
    pub mint: Pubkey,              // 32
    pub contributions: u64,        // 8
    pub allocations: u64,          // 8
    pub excess_contributions: u64, // 8
}

impl AssetTotal {
    pub const MAXIMUM_SIZE: usize = 1 + 32 + 8 + 8 + 8;

    pub fn make_from_slice(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == INDEX_ACCEPTED_TOKEN_END,
            SaleError::InvalidAcceptedTokenPayload
        );
        Ok(AssetTotal {
            token_index: bytes[INDEX_ACCEPTED_TOKEN_INDEX],
            mint: Pubkey::new(&bytes[INDEX_ACCEPTED_TOKEN_ADDRESS..INDEX_ACCEPTED_TOKEN_END]),
            contributions: 0,
            allocations: 0,
            excess_contributions: 0,
        })
    }
}

impl Sale {
    pub const MAXIMUM_SIZE: usize = 32
        + 32
        + 32
        + 2
        + 1
        + (8 + 8)
        + 32
        + 1
        + 1
        + (4 + AssetTotal::MAXIMUM_SIZE * ACCEPTED_TOKENS_MAX)
        + 1
        + 1;

    pub fn set_custodian(&mut self, custodian: &Pubkey) {
        self.custodian = custodian.clone();
    }

    pub fn parse_sale_init(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.initialized, SaleError::SaleAlreadyInitialized);
        self.initialized = true;

        // check that the payload has at least the number of bytes
        // required to define the number of accepted tokens
        require!(
            payload.len() > INDEX_SALE_INIT_ACCEPTED_TOKENS_START,
            SaleError::IncorrectVaaPayload
        );

        let num_accepted = payload[INDEX_SALE_INIT_ACCEPTED_TOKENS_START] as usize;
        require!(
            num_accepted <= ACCEPTED_TOKENS_MAX,
            SaleError::TooManyAcceptedTokens
        );

        self.totals = Vec::with_capacity(ACCEPTED_TOKENS_MAX);
        for i in 0..num_accepted {
            let start = INDEX_SALE_INIT_ACCEPTED_TOKENS_START + 1 + ACCEPTED_TOKEN_NUM_BYTES * i;
            self.totals.push(AssetTotal::make_from_slice(
                &payload[start..start + ACCEPTED_TOKEN_NUM_BYTES],
            )?);
        }

        self.id = Sale::get_id(payload);

        // deserialize other things
        self.associated_sale_token_address =
            Pubkey::new(&to_bytes32(payload, INDEX_SALE_INIT_TOKEN_ADDRESS));
        self.token_chain = to_u16_be(payload, INDEX_SALE_INIT_TOKEN_CHAIN);
        self.token_decimals = payload[INDEX_SALE_INIT_TOKEN_DECIMALS];

        // assume these times are actually u64... these are stored as uint256 in evm
        self.times.start = to_u64_be(payload, INDEX_SALE_INIT_SALE_START + 24);
        self.times.end = to_u64_be(payload, INDEX_SALE_INIT_SALE_END + 24);

        // because the accepted tokens are packed in before the recipient... we need to find
        // where this guy is based on how many accepted tokens there are. yes, we hate this, too
        let recipient_idx =
            INDEX_SALE_INIT_ACCEPTED_TOKENS_START + 1 + ACCEPTED_TOKEN_NUM_BYTES * num_accepted;
        self.recipient = to_bytes32(payload, recipient_idx);

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
    }

    pub fn set_native_sale_token_decimals(&mut self, decimals: u8) -> Result<()> {
        require!(
            self.token_decimals >= decimals,
            SaleError::InvalidTokenDecimals
        );
        self.native_token_decimals = decimals;
        Ok(())
    }

    pub fn get_token_index(&self, mint: &Pubkey) -> Result<u8> {
        let result = self.totals.iter().find(|item| item.mint == *mint);
        require!(result != None, SaleError::InvalidTokenIndex);
        Ok(result.unwrap().token_index)
    }

    pub fn get_associated_accepted_token_address(
        &self,
        token_index: u8,
        owner: &Pubkey,
    ) -> Result<Pubkey> {
        let idx = self.get_index(token_index)?;
        Ok(get_associated_token_address(owner, &self.totals[idx].mint))
    }

    pub fn update_total_contributions(
        &mut self,
        block_time: i64,
        token_index: u8,
        contributed: u64,
    ) -> Result<usize> {
        require!(self.is_active(block_time), SaleError::SaleEnded);

        let block_time = block_time as u64;
        require!(
            block_time >= self.times.start,
            SaleError::ContributionTooEarly
        );
        let idx = self.get_index(token_index)?;
        self.totals[idx].contributions += contributed;

        Ok(idx)
    }

    pub fn serialize_contributions(&self, block_time: i64) -> Result<Vec<u8>> {
        require!(self.is_attestable(block_time), SaleError::SaleNotAttestable);

        let totals = &self.totals;
        let mut attested: Vec<u8> = Vec::with_capacity(
            PAYLOAD_HEADER_LEN + totals.len() * ATTEST_CONTRIBUTIONS_ELEMENT_LEN,
        );

        // push header
        attested.push(PAYLOAD_ATTEST_CONTRIBUTIONS);
        attested.extend(self.id.iter());

        // push each total contributions
        for total in totals {
            attested.push(total.token_index);
            attested.extend(total.contributions.to_be_bytes());
        }
        Ok(attested)
    }

    pub fn parse_sale_sealed(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.has_ended(), SaleError::SaleEnded);
        // check that the payload has at least the number of bytes
        // required to define the number of allocations
        require!(
            payload.len() > INDEX_SALE_SEALED_ALLOCATIONS_START,
            SaleError::IncorrectVaaPayload
        );

        let totals = &mut self.totals;
        let num_allocations = payload[INDEX_SALE_SEALED_ALLOCATIONS_START] as usize;
        require!(
            num_allocations == totals.len(),
            SaleError::IncorrectVaaPayload
        );

        let grand_total_allocations: u64 = 0;
        let decimal_difference = (self.token_decimals - self.native_token_decimals) as u32;

        // deserialize other things
        for i in 0..num_allocations {
            let start = INDEX_SALE_SEALED_ALLOCATIONS_START + 1 + ALLOCATION_NUM_BYTES * i;

            // convert allocation to u64 based on decimal difference
            // TODO: put in a separate method
            let allocation = BigUint::from_bytes_be(
                &payload[start + INDEX_ALLOCATIONS_AMOUNT..start + INDEX_ALLOCATIONS_EXCESS],
            );

            let adjusted = allocation / BigUint::from(10u128).pow(decimal_difference);
            require!(
                adjusted < BigUint::from(u64::MAX),
                SaleError::AmountTooLarge
            );

            // is there a better way to do this part?
            let adjusted = &adjusted.to_bytes_be();

            // take first 24 bytes and see if this is greater than zero
            let excess_contributions = BigUint::from_bytes_be(
                &payload[start + INDEX_ALLOCATIONS_AMOUNT..start + INDEX_ALLOCATIONS_EXCESS + 24],
            );
            require!(
                excess_contributions > BigUint::from(0 as u128),
                SaleError::AmountTooLarge
            );

            let total = &mut totals[i];
            // now take last 8 bytes
            total.excess_contributions = u64::from_be_bytes(
                payload[start + INDEX_ALLOCATIONS_AMOUNT + 24..start + INDEX_ALLOCATIONS_EXCESS]
                    .try_into()
                    .unwrap(),
            );
        }

        // finally set the status to sealed
        self.status = SaleStatus::Sealed;

        Ok(())
    }

    pub fn parse_sale_aborted(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.has_ended(), SaleError::SaleEnded);

        // check that the payload has the correct size
        // payload type + sale id
        require!(
            payload.len() == PAYLOAD_HEADER_LEN,
            SaleError::IncorrectVaaPayload
        );

        // finally set the status to aborted
        self.status = SaleStatus::Aborted;

        Ok(())
    }

    pub fn is_active(&self, block_time: i64) -> bool {
        self.initialized && self.status == SaleStatus::Active && block_time as u64 <= self.times.end
    }

    fn is_attestable(&self, block_time: i64) -> bool {
        self.initialized && self.status == SaleStatus::Active && block_time as u64 > self.times.end
    }

    pub fn has_ended(&self) -> bool {
        return self.initialized && self.status != SaleStatus::Active;
    }

    pub fn is_sealed(&self) -> bool {
        return self.initialized && self.status == SaleStatus::Sealed;
    }

    pub fn is_aborted(&self) -> bool {
        return self.initialized && self.status == SaleStatus::Aborted;
    }

    pub fn get_index(&self, token_index: u8) -> Result<usize> {
        let result = self
            .totals
            .iter()
            .position(|item| item.token_index == token_index);
        require!(result != None, SaleError::InvalidTokenIndex);
        Ok(result.unwrap())
    }

    fn get_id(payload: &[u8]) -> [u8; 32] {
        to_bytes32(payload, INDEX_SALE_ID)
    }
}

// assuming all slices are the correct sizes...
fn to_u16_be(bytes: &[u8], index: usize) -> u16 {
    u16::from_be_bytes(bytes[index..index + 2].try_into().unwrap())
}

fn to_u64_be(bytes: &[u8], index: usize) -> u64 {
    u64::from_be_bytes(bytes[index..index + 8].try_into().unwrap())
}

fn to_bytes32(bytes: &[u8], index: usize) -> [u8; 32] {
    bytes[index..index + 32].try_into().unwrap()
}

pub fn verify_conductor_vaa<'info>(
    vaa_account: &AccountInfo<'info>,
    payload_type: u8,
) -> Result<MessageData> {
    let msg = get_message_data(&vaa_account)?;

    require!(
        vaa_account.to_account_info().owner == &Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap(),
        SaleError::InvalidVaaAction
    );
    require!(
        msg.emitter_chain == get_conductor_chain()?,
        SaleError::InvalidConductor
    );
    require!(
        msg.emitter_address == get_conductor_address()?,
        SaleError::InvalidConductor
    );
    require!(msg.payload[0] == payload_type, SaleError::InvalidVaaAction);
    Ok(msg)
}

// TODO: set up cfg flag to just use constants instead of these getters
pub fn get_conductor_chain() -> Result<u16> {
    let conductor_chain: u16 = CONDUCTOR_CHAIN
        .to_string()
        .parse()
        .expect("invalid conductor chain");
    Ok(conductor_chain)
}

pub fn get_conductor_address() -> Result<[u8; 32]> {
    let conductor_address = hex::decode(CONDUCTOR_ADDRESS).expect("invalid conductor address");
    let conductor_address: [u8; 32] = conductor_address
        .try_into()
        .expect("invalid conductor address");
    Ok(conductor_address)
}
