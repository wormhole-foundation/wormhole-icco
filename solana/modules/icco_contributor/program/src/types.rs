use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use solana_program::pubkey::Pubkey;
use solitaire::{
    pack_type,
    processors::seeded::{AccountOwner, Owned},
};
use spl_token::state::{Account, Mint};
//use spl_token_metadata::state::Metadata;

pub type Address = [u8; 32];
pub type ChainID = u16;

/// icco contributor contract configuration Data.
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
pub struct Config {
    pub wormhole_bridge: Pubkey,
    pub icco_conductor: Pubkey,
}

impl Owned for Config {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}


/// Temp test account data. If needed.
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize)]
pub struct TestStruct {
}

impl Owned for TestStruct {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}


/// icco sale state. Writeable in init, seal, abort.
/// Only static sizing is working well in here, so 256 is preallocated.
//#[derive(Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize)]
pub struct SaleMint {
}

impl Owned for SaleMint {
    fn owner(&self) -> AccountOwner {
        AccountOwner::Any
    }
}


/// icco sale state. Writeable in init, seal, abort.
/// Only static sizing is working well in here, so 256 is preallocated.
//#[derive(Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize)]
pub struct SaleState {
}

impl Owned for SaleState {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}

/// icco contribution state. Writeable in contribute, redeem, refund.
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
pub struct ContributionState {
    pub amount: u64,
    pub is_redeemed_or_refunded: u8,
}

impl Owned for ContributionState {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}


/// Chain + AccountPubkey.
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
pub struct EndpointRegistration {
    pub chain: ChainID,
    pub contract: Address,
}

impl Owned for EndpointRegistration {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}

/*
#[derive(Default, Clone, Copy, BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
pub struct WrappedMeta {
    pub chain: ChainID,
    pub token_address: Address,
    pub original_decimals: u8,
}

impl Owned for WrappedMeta {
    fn owner(&self) -> AccountOwner {
        AccountOwner::This
    }
}
*/
pack_type!(SplMint, Mint, AccountOwner::Other(spl_token::id()));
pack_type!(SplAccount, Account, AccountOwner::Other(spl_token::id()));
