
#![feature(adt_const_params)]
#![deny(unused_must_use)]

// #![cfg(all(target_arch = "bpf", not(feature = "no-entrypoint")))]

#[cfg(feature = "no-entrypoint")]
pub mod instructions;

#[cfg(feature = "wasm")]
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
extern crate wasm_bindgen;

#[cfg(feature = "wasm")]
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub mod wasm;

pub mod accounts;
pub mod api;
pub mod messages;
pub mod types;

pub use api::{
    initialize,
    register_chain,
    upgrade_contract,
    Initialize,
    InitializeData,
    RegisterChain,
    RegisterChainData,
    UpgradeContract,
    UpgradeContractData,
};

use solitaire::*;
//use std::error::Error;

pub enum TokenBridgeError {
    AlreadyExecuted,
    InvalidChain,
    InvalidGovernanceKey,
    InvalidMetadata,
    InvalidMint,
    InvalidPayload,
    InvalidUTF8String,
    TokenNotNative,
    UninitializedMint,
    WrongAccountOwner,
    InvalidFee,
    InvalidRecipient,
}

impl From<TokenBridgeError> for SolitaireError {
    fn from(t: TokenBridgeError) -> SolitaireError {
        SolitaireError::Custom(t as u64)
    }
}

solitaire! {
    Initialize(InitializeData) => initialize,
    RegisterChain(RegisterChainData) => register_chain,
    UpgradeContract(UpgradeContractData) => upgrade_contract,
}
