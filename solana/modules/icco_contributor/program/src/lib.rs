#![allow(dead_code)]
#![feature(adt_const_params)]
#![deny(unused_must_use)]

// #![cfg(all(target_arch = "bpf", not(feature = "no-entrypoint")))]

// #[cfg(feature = "no-entrypoint")]
// pub mod instructions;

#[cfg(feature = "wasm")]
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
extern crate wasm_bindgen;

#[cfg(feature = "wasm")]
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub mod wasm;

pub mod accounts;
pub mod api;
pub mod errors;
pub mod messages;
pub mod types;
pub mod claimed_vaa;
pub mod simple_account;
pub mod instructions;

pub use api::{
    contribute_icco_sale,
    init_icco_sale,
    initialize,
    create_icco_sale_custody_account,
    abort_icco_sale,
    attest_icco_sale,
    seal_icco_sale_transfer_custody, 
    seal_icco_sale,
    
    ContributeIccoSale,
    InitIccoSale,
    Initialize,
    CreateIccoSaleCustodyAccount,
    AbortIccoSale,
    AttestIccoSale,
    TransferCustodyIccoToken,
    SealIccoSale,
};

use solitaire::*;

solitaire! {
    Initialize => initialize,
    CreateIccoSaleCustodyAccount => create_icco_sale_custody_account,
    InitIccoSale  => init_icco_sale,
    AbortIccoSale  => abort_icco_sale,
    AttestIccoSale  => attest_icco_sale,
    ContributeIccoSale => contribute_icco_sale,
    SealIccoSale  => seal_icco_sale,
}
