#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use crate::{
    accounts::{
        AuthoritySigner,
        ConfigAccount,
        SaleStateAccount,
        SaleStateDerivationData,
        CustodyAccount,
        CustodyAccountDerivationData,
        CustodySigner,
        EmitterAccount,
//        Endpoint,
//        EndpointDerivationData,
//        MintSigner,
        SplTokenMeta,
        SplTokenMetaDerivationData,
    },
    api::{
        CreateIccoSaleCustodyAccountData,
        InitIccoSaleData,
        AbortIccoSaleData,
    },
};
use borsh::BorshSerialize;
use bridge::{
    accounts::{
        Bridge,
        BridgeConfig,
        Claim,
        ClaimDerivationData,
        FeeCollector,
        PostedVAA,
        PostedVAAData,
        PostedVAADerivationData,
        Sequence,
        SequenceDerivationData,
    },
    api::ForeignAddress,
    instructions::hash_vaa,
    vaa::{
        ClaimableVAA,
        PayloadMessage,
        SerializePayload,
    },
    PostVAA,
    PostVAAData,
    CHAIN_ID_SOLANA,
};
use primitive_types::U256;
use solana_program::{
    instruction::{
        AccountMeta,
        Instruction,
    },
    pubkey::Pubkey,
    msg,
};

use solitaire::{
    processors::seeded::Seeded,
    AccountState,
};
use spl_token::{
//    error::TokenError::OwnerMismatch,
    state::{
        Account,
        Mint,
    },
};

use std::str::FromStr;

pub fn initialize(
    program_id: Pubkey,
    payer: Pubkey,
    bridge: Pubkey,
    conductor: Pubkey,
) -> solitaire::Result<Instruction> {
    let config_key = ConfigAccount::<'_, { AccountState::Uninitialized }>::key(None, &program_id);
    Ok(Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(config_key, false),
            // Dependencies
            AccountMeta::new(solana_program::sysvar::rent::id(), false),
            AccountMeta::new(solana_program::system_program::id(), false),
        ],
        data: (crate::instruction::Instruction::Initialize, bridge, conductor).try_to_vec()?,
    })
}


fn claimable_vaa(
    bridge_id: Pubkey,
    message_key: Pubkey,
    vaa: PostVAAData,
) -> (AccountMeta, AccountMeta) {
    let claim_key = Claim::<'_, { AccountState::Initialized }>::key(
        &ClaimDerivationData {
            emitter_address: vaa.emitter_address,
            emitter_chain: vaa.emitter_chain,
            sequence: vaa.sequence,
        },
        &bridge_id,
    );

    (
        AccountMeta::new_readonly(message_key, false),
        AccountMeta::new(claim_key, false),
    )
}


pub fn create_icco_sale_custody_account(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    payload_message: Pubkey,
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
    token_mint: Pubkey,
    _token_index: u8,  // TBD For validation against VAA. 
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let custody_key = CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&CustodyAccountDerivationData{sale_id: sale_id, mint: token_mint}, &program_id);
    let claim = Claim::<'_, { AccountState::Uninitialized }>::key(
        &ClaimDerivationData {
            emitter_address: emitter.to_bytes(),
            emitter_chain: emitter_chain,
            sequence,
        },
        &program_id,
    );

    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new_readonly(payload_message, false),
            AccountMeta::new(claim, false),
            AccountMeta::new_readonly(token_mint, false),       // Mint.
//            AccountMeta::new(payer, true),                      // Use payer as custody_signer 
            AccountMeta::new(custody_key, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: (
            crate::instruction::Instruction::CreateIccoSaleCustodyAccount,
            CreateIccoSaleCustodyAccountData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}



pub fn init_icco_sale(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    payload_message: Pubkey,
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Uninitialized }>::key(&SaleStateDerivationData{sale_id: sale_id}, &program_id);
    
    let claim = Claim::<'_, { AccountState::Uninitialized }>::key(
        &ClaimDerivationData {
            emitter_address: emitter.to_bytes(),
            emitter_chain: emitter_chain,
            sequence,
        },
        &program_id,
    );

    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new(state_key, false),
            AccountMeta::new_readonly(payload_message, false),
            AccountMeta::new(claim, false),
//            AccountMeta::new(program_id, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ],

        data: (
            crate::instruction::Instruction::InitIccoSale,
            InitIccoSaleData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}

pub fn get_icco_state_address (program_id: Pubkey, sale_id: u128) -> Pubkey {
    SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateDerivationData{sale_id: sale_id}, &program_id)
}

pub fn get_icco_sale_custody_account_address(program_id: Pubkey, sale_id: u128, token_mint: Pubkey) -> Pubkey {
    CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&CustodyAccountDerivationData{sale_id: sale_id, mint: token_mint}, &program_id)
}

pub fn abort_icco_sale(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    payload_message: Pubkey,    // Abort VAA
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateDerivationData{sale_id: sale_id}, &program_id);
    
    let claim = Claim::<'_, { AccountState::Uninitialized }>::key(
        &ClaimDerivationData {
            emitter_address: emitter.to_bytes(),
            emitter_chain: emitter_chain,
            sequence,
        },
        &program_id,
    );

    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new(state_key, false),
            AccountMeta::new_readonly(payload_message, false),
            AccountMeta::new(claim, false),
//            AccountMeta::new(program_id, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ],

        data: (
            crate::instruction::Instruction::AbortIccoSale,
            AbortIccoSaleData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}
