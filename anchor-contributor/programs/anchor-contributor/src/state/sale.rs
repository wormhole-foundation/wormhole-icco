use anchor_lang::{prelude::*, solana_program::keccak};
use anchor_spl::{
    associated_token::get_associated_token_address,
    token::{Mint, TokenAccount},
};
use num::{bigint::BigUint, traits::ToPrimitive};
use num_derive::*;
use std::{mem::size_of_val, u64};

use crate::{
    constants::*, cryptography::ethereum_ecrecover, error::ContributorError,
    state::custodian::Custodian,
};

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct AssetTotal {
    pub token_index: u8,           // 1
    pub mint: Pubkey,              // 32
    pub contributions: u64,        // 8
    pub allocations: u64,          // 8
    pub excess_contributions: u64, // 8
    pub status: AssetStatus,       // 1
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum AssetStatus {
    Active,
    NothingToTransfer,
    ReadyForTransfer,
    TransferredToConductor,
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub struct SaleTimes {
    pub start: u64,             // 8
    pub end: u64,               // 8
    pub unlock_allocation: u64, // 8
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
pub struct Sale {
    pub id: [u8; 32],                          // 32
    pub associated_sale_token_address: Pubkey, // 32
    pub token_chain: u16,                      // 2
    pub token_decimals: u8,                    // 1
    pub times: SaleTimes,                      // SaleStatus::LEN
    pub recipient: [u8; 32],                   // 32
    pub status: SaleStatus,                    // 1
    pub kyc_authority: [u8; 20],               // 20 (this is an evm pubkey)
    pub initialized: bool,                     // 1

    pub totals: Vec<AssetTotal>, // 4 + AssetTotal::LEN * ACCEPTED_TOKENS_MAX
    pub native_token_decimals: u8, // 1
    pub sale_token_mint: Pubkey, // 32
}

impl SaleTimes {
    pub const LEN: usize = 8 + 8 + 8;
}

impl AssetTotal {
    pub const LEN: usize = 1 + 32 + 8 + 8 + 8 + 1;

    pub fn make_from_slice(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == INDEX_ACCEPTED_TOKEN_END,
            ContributorError::InvalidAcceptedTokenPayload
        );

        Ok(Self {
            token_index: bytes[INDEX_ACCEPTED_TOKEN_INDEX],
            mint: Pubkey::new(&bytes[INDEX_ACCEPTED_TOKEN_ADDRESS..INDEX_ACCEPTED_TOKEN_END]),
            contributions: 0,
            allocations: 0,
            excess_contributions: 0,
            status: AssetStatus::Active,
        })
    }

    pub fn prepare_for_transfer(&mut self) {
        self.status = {
            if self.contributions == 0 {
                AssetStatus::NothingToTransfer
            } else {
                AssetStatus::ReadyForTransfer
            }
        };
    }

    pub fn is_ready_for_transfer(&self) -> bool {
        self.status == AssetStatus::ReadyForTransfer
    }

    pub fn set_transferred(&mut self) {
        self.status = AssetStatus::TransferredToConductor;
    }

    pub fn deserialize_associated_token_account(
        &self,
        token_acct_info: &AccountInfo,
        authority: &Pubkey,
    ) -> Result<TokenAccount> {
        require!(
            get_associated_token_address(authority, &self.mint) == token_acct_info.key(),
            ContributorError::InvalidAccount
        );
        AssetTotal::deserialize_token_account_unchecked(token_acct_info)
    }

    pub fn deserialize_token_account(
        &self,
        token_acct_info: &AccountInfo,
        owner: &Pubkey,
    ) -> Result<TokenAccount> {
        let token_acct = AssetTotal::deserialize_token_account_unchecked(token_acct_info)?;
        require!(token_acct.owner == *owner, ContributorError::InvalidAccount);
        require!(
            token_acct.mint == self.mint,
            ContributorError::InvalidAccount
        );
        Ok(token_acct)
    }

    pub fn deserialize_token_account_unchecked(
        token_acct_info: &AccountInfo,
    ) -> Result<TokenAccount> {
        let mut bf: &[u8] = &token_acct_info.try_borrow_data()?;
        TokenAccount::try_deserialize_unchecked(&mut bf)
    }
}

impl Sale {
    pub const MAXIMUM_SIZE: usize = 32
        + 32
        + 2
        + 1
        + SaleTimes::LEN
        + 32
        + 1
        + 20
        + 1
        + (4 + AssetTotal::LEN * ACCEPTED_TOKENS_MAX)
        + 1
        + 32;

    pub fn parse_sale_init(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.initialized, ContributorError::SaleAlreadyInitialized);
        self.initialized = true;

        // check that the payload has at least the number of bytes
        // required to define the number of accepted tokens
        require!(
            payload.len() > INDEX_SALE_INIT_ACCEPTED_TOKENS_START,
            ContributorError::InvalidVaaPayload
        );

        let num_accepted = payload[INDEX_SALE_INIT_ACCEPTED_TOKENS_START] as usize;
        require!(
            num_accepted <= ACCEPTED_TOKENS_MAX,
            ContributorError::TooManyAcceptedTokens
        );

        self.totals = Vec::with_capacity(ACCEPTED_TOKENS_MAX);
        for i in 0..num_accepted {
            let start = INDEX_SALE_INIT_ACCEPTED_TOKENS_START + 1 + ACCEPTED_TOKEN_NUM_BYTES * i;
            self.totals.push(AssetTotal::make_from_slice(
                &payload[start..(start + ACCEPTED_TOKEN_NUM_BYTES)],
            )?);
        }

        self.id = Sale::get_id(payload);

        // deserialize other things
        let mut addr = [0u8; 32];
        addr.copy_from_slice(
            &payload[INDEX_SALE_INIT_TOKEN_ADDRESS..(INDEX_SALE_INIT_TOKEN_ADDRESS + 32)],
        );
        self.associated_sale_token_address = Pubkey::new(&addr);
        self.token_chain = to_u16_be(payload, INDEX_SALE_INIT_TOKEN_CHAIN);
        self.token_decimals = payload[INDEX_SALE_INIT_TOKEN_DECIMALS];

        // assume these times are actually u64... these are stored as uint256 in evm
        self.times.start = to_u64_be(payload, INDEX_SALE_INIT_SALE_START + 24);
        self.times.end = to_u64_be(payload, INDEX_SALE_INIT_SALE_END + 24);

        // because the accepted tokens are packed in before the recipient... we need to find
        // where this guy is based on how many accepted tokens there are. yes, we hate this, too
        let recipient_idx =
            INDEX_SALE_INIT_ACCEPTED_TOKENS_START + 1 + ACCEPTED_TOKEN_NUM_BYTES * num_accepted;
        self.recipient
            .copy_from_slice(&payload[recipient_idx..(recipient_idx + 32)]);

        // each sale has its own kyc authority
        self.kyc_authority
            .copy_from_slice(&payload[(recipient_idx + 32)..(recipient_idx + 52)]);

        // when to unlock sale allocation if the sale is sealed
        self.times.unlock_allocation = to_u64_be(payload, recipient_idx + 52 + 24);

        // finally set the status to active
        self.status = SaleStatus::Active;

        Ok(())
    }

    pub fn set_sale_token_mint_info(&mut self, mint: &Pubkey, mint_info: &Mint) -> Result<()> {
        let decimals = mint_info.decimals;
        require!(
            self.token_decimals >= decimals,
            ContributorError::InvalidTokenDecimals
        );
        self.native_token_decimals = decimals;
        self.sale_token_mint = mint.clone();
        Ok(())
    }

    pub fn get_token_index(&self, mint: &Pubkey) -> Result<u8> {
        let result = self.totals.iter().find(|item| item.mint == *mint);
        require!(result != None, ContributorError::InvalidTokenIndex);
        Ok(result.unwrap().token_index)
    }

    pub fn get_total_info(&self, mint: &Pubkey) -> Result<(usize, &AssetTotal)> {
        let result = self.totals.iter().position(|item| item.mint == *mint);
        require!(result != None, ContributorError::InvalidTokenIndex);
        let idx = result.unwrap();
        Ok((idx, &self.totals[idx]))
    }

    pub fn update_total_contributions(
        &mut self,
        block_time: i64,
        token_index: u8,
        contributed: u64,
    ) -> Result<usize> {
        require!(self.is_active(block_time), ContributorError::SaleEnded);

        let block_time = block_time as u64;
        require!(
            block_time >= self.times.start,
            ContributorError::ContributionTooEarly
        );
        let idx = self.get_index(token_index)?;
        self.totals[idx].contributions += contributed;

        Ok(idx)
    }

    pub fn serialize_contributions(&self, block_time: i64) -> Result<Vec<u8>> {
        require!(
            self.is_attestable(block_time),
            ContributorError::SaleNotAttestable
        );

        let totals = &self.totals;
        // Contributions length is encoded as a single byte, so we fail here if it overflows
        let contributions_len: u8 = totals.len().try_into().unwrap();
        let mut attested: Vec<u8> = Vec::with_capacity(
            PAYLOAD_HEADER_LEN
                + size_of_val(&CHAIN_ID)
                + size_of_val(&contributions_len)
                + totals.len() * ATTEST_CONTRIBUTIONS_ELEMENT_LEN,
        );

        // push header
        attested.push(PAYLOAD_ATTEST_CONTRIBUTIONS);
        attested.extend(self.id.iter());
        attested.extend(CHAIN_ID.to_be_bytes());

        // push contributions length
        attested.push(contributions_len);

        // push each total contributions
        for total in totals {
            attested.push(total.token_index);
            attested.extend(vec![0; PAD_U64]); // contribution is 8 bytes, but we need 32 bytes in the payload, so we left-pad
            attested.extend(total.contributions.to_be_bytes());
        }
        Ok(attested)
    }

    pub fn parse_sale_sealed(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.has_ended(), ContributorError::SaleEnded);
        // check that the payload has at least the number of bytes
        // required to define the number of allocations
        require!(
            payload.len() > INDEX_SALE_SEALED_ALLOCATIONS_START,
            ContributorError::InvalidVaaPayload
        );

        let num_allocations = payload[INDEX_SALE_SEALED_ALLOCATIONS_START] as usize;
        require!(
            num_allocations == self.totals.len(),
            ContributorError::InvalidVaaPayload
        );

        let decimal_difference = (self.token_decimals - self.native_token_decimals) as u32;
        let pow10_divider = BigUint::from(10u128).pow(decimal_difference);

        // deserialize other things
        for i in 0..num_allocations {
            let start = INDEX_SALE_SEALED_ALLOCATIONS_START + 1 + ALLOCATION_NUM_BYTES * i;
            let total = &self.totals[i];
            require!(
                payload[start] == total.token_index,
                ContributorError::InvalidVaaPayload
            );

            let total = &mut self.totals[i];

            // convert allocation to u64 based on decimal difference and save
            let raw_allocation = BigUint::from_bytes_be(
                &payload[(start + INDEX_ALLOCATIONS_AMOUNT)..(start + INDEX_ALLOCATIONS_EXCESS)],
            );
            total.allocations = (raw_allocation / pow10_divider.clone())
                .to_u64()
                .ok_or(ContributorError::AmountTooLarge)?;

            // and save excess contribution
            total.excess_contributions = BigUint::from_bytes_be(
                &payload[(start + INDEX_ALLOCATIONS_EXCESS)..(start + INDEX_ALLOCATIONS_END)],
            )
            .to_u64()
            .ok_or(ContributorError::AmountTooLarge)?;
        }

        // finally set the status to sealed
        self.status = SaleStatus::Sealed;

        Ok(())
    }

    pub fn parse_sale_aborted(&mut self, payload: &[u8]) -> Result<()> {
        require!(!self.has_ended(), ContributorError::SaleEnded);

        // check that the payload has the correct size
        // payload type + sale id
        require!(
            payload.len() == PAYLOAD_HEADER_LEN,
            ContributorError::InvalidVaaPayload
        );

        // finally set the status to aborted
        self.status = SaleStatus::Aborted;

        Ok(())
    }

    pub fn verify_kyc_authority(
        &self,
        token_index: u8,
        amount: u64,
        buyer: &Pubkey,
        prev_contribution: u64,
        kyc_signature: &[u8],
    ) -> Result<()> {
        require!(
            kyc_signature.len() == 65,
            ContributorError::InvalidKycSignature
        );
        // first encode arguments
        let mut encoded: Vec<u8> = Vec::with_capacity(6 * 32);

        // grab conductor address from Custodian
        encoded.extend(Custodian::conductor_address()?); // 32

        // sale id
        encoded.extend(self.id); // 32

        // token index
        encoded.extend(vec![0u8; PAD_U8]); // 31 (zero padding u8)
        encoded.push(token_index); // 1

        // amount
        encoded.extend(vec![0u8; PAD_U64]); // 24
        encoded.extend(amount.to_be_bytes()); // 8

        // buyer
        encoded.extend(buyer.to_bytes()); // 32

        // previously contributed amount
        encoded.extend(vec![0u8; PAD_U64]); // 24
        encoded.extend(prev_contribution.to_be_bytes()); // 8

        let hash = keccak::hash(&encoded);
        let recovered = ethereum_ecrecover(kyc_signature, &hash.to_bytes())?;

        require!(
            recovered == self.kyc_authority,
            ContributorError::InvalidKycSignature
        );
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
        require!(result != None, ContributorError::InvalidTokenIndex);
        Ok(result.unwrap())
    }

    pub fn allocation_unlocked(&self, block_time: i64) -> bool {
        block_time as u64 >= self.times.unlock_allocation
    }

    fn get_id(payload: &[u8]) -> [u8; 32] {
        let mut output = [0u8; 32];
        output.copy_from_slice(&payload[INDEX_SALE_ID..(INDEX_SALE_ID + 32)]);
        output
    }
}

// assuming all slices are the correct sizes...
fn to_u16_be(bytes: &[u8], index: usize) -> u16 {
    u16::from_be_bytes(bytes[index..(index + 2)].try_into().unwrap())
}

fn to_u64_be(bytes: &[u8], index: usize) -> u64 {
    u64::from_be_bytes(bytes[index..(index + 8)].try_into().unwrap())
}
