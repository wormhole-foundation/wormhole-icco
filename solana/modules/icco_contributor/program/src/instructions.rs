#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use crate::{
    accounts::{
        AuthoritySigner,
        ConfigAccount,
        SaleStateAccount,
        SaleStateAccountDerivationData,
        SaleCustodyAccountDerivationData,
        CustodyAccount,
        CustodyAccountDerivationData,
        CustodySigner,
        EmitterAccount,
        SplTokenMeta,
        SplTokenMetaDerivationData,
        ContributionStateAccount,
        ContributionStateAccountDerivationData,
    },
    api::{
        CreateIccoSaleCustodyAccountData,
        InitIccoSaleData,
        AbortIccoSaleData,
        ContributeIccoSaleData,
        AttestIccoSaleData,
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

use wormhole_sdk::{
    id,
    config,
    fee_collector,
    sequence,
    emitter,
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
use std::convert::TryInto;

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
    vaa_message: Pubkey,
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
    token_mint: Pubkey,
    _token_index: u8,  // TBD For validation against VAA. 
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
//    let test_key = TestAccount::<'_, { AccountState::Uninitialized }>::key(&TestAccountDerivationData{sale_id: sale_id}, &program_id);
    let custody_key = CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&CustodyAccountDerivationData{sale_id: sale_id, mint: token_mint}, &program_id);
    let vaa_claim = Claim::<'_, { AccountState::Uninitialized }>::key(
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
            AccountMeta::new_readonly(vaa_message, false),
            AccountMeta::new(vaa_claim, false),
            AccountMeta::new_readonly(token_mint, false),       // Mint.
            AccountMeta::new(custody_key, false),
            AccountMeta::new_readonly(program_id, false),       // <--- As custody owner?
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
//            AccountMeta::new(test_key, false),
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
    vaa_message: Pubkey,
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
    token_mint: &[u8;32],
    tmp_token_key: Pubkey,
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Uninitialized }>::key(&SaleStateAccountDerivationData{sale_id: sale_id}, &program_id);
    let sale_custody = CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&SaleCustodyAccountDerivationData{foreign_mint: *token_mint}, &program_id);

    let vaa_claim = Claim::<'_, { AccountState::Uninitialized }>::key(
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
            AccountMeta::new_readonly(vaa_message, false),
            AccountMeta::new(vaa_claim, false),
            AccountMeta::new_readonly(tmp_token_key, false), // TBD MINT!!!
            AccountMeta::new(sale_custody, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new(state_key, false),
        ],

        data: (
            crate::instruction::Instruction::InitIccoSale,
            InitIccoSaleData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}

/*
pub fn get_test_account_address (program_id: Pubkey, sale_id: u128) -> Pubkey {
    TestAccount::<'_, { AccountState::Initialized }>::key(&TestAccountDerivationData{sale_id: sale_id}, &program_id)
}
*/

pub fn get_icco_state_address (program_id: Pubkey, sale_id: u128) -> Pubkey {
    SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateAccountDerivationData{sale_id: sale_id}, &program_id)
}

pub fn get_icco_sale_custody_account_address(program_id: Pubkey, sale_id: u128, token_mint: Pubkey) -> Pubkey {
    CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&CustodyAccountDerivationData{sale_id: sale_id, mint: token_mint}, &program_id)
}

pub fn get_icco_sale_custody_account_address_for_sale_token(program_id: Pubkey, src_mint: [u8; 32]) -> Pubkey {
    CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&SaleCustodyAccountDerivationData{foreign_mint: src_mint}, &program_id)
}

pub fn abort_icco_sale(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    vaa_message: Pubkey,    // Abort VAA
    emitter: Pubkey,
    emitter_chain: u16,
    sequence: u64,
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateAccountDerivationData{sale_id: sale_id}, &program_id);
    
    let vaa_claim = Claim::<'_, { AccountState::Uninitialized }>::key(
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
            AccountMeta::new_readonly(vaa_message, false),
            AccountMeta::new(vaa_claim, false),
//            AccountMeta::new(program_id, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new(state_key, false),
        ],

        data: (
            crate::instruction::Instruction::AbortIccoSale,
            AbortIccoSaleData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}


pub fn contribute_icco_sale(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    from_account: Pubkey,
    vaa_message: Pubkey,    // initSale, claimed
    // emitter: Pubkey,
    // emitter_chain: u16,
    // sequence: u64,
    token_mint: Pubkey,
    token_index: u8,  // TBD For validation against VAA. 
    amount: u64,
) -> Instruction {
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateAccountDerivationData{sale_id: sale_id}, &program_id);
    let contribution_state_key =
        ContributionStateAccount::<'_, { AccountState::MaybeInitialized }>::key(&ContributionStateAccountDerivationData{
            sale_id: sale_id,
            contributor: payer,
            token: token_mint,
        }, &program_id);
    let custody_key = CustodyAccount::<'_, { AccountState::MaybeInitialized }>::key(&CustodyAccountDerivationData{sale_id: sale_id, mint: token_mint}, &program_id);

    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new_readonly(vaa_message, false),
            AccountMeta::new(contribution_state_key, false),
            AccountMeta::new(from_account, false),
            AccountMeta::new_readonly(token_mint, false),       // Mint.
            AccountMeta::new(custody_key, false),
//Not needed            AccountMeta::new_readonly(program_id, false),       // <--- As custody owner?
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new(state_key, false),
        ],
        data: (
            crate::instruction::Instruction::ContributeIccoSale,
            ContributeIccoSaleData {amount: amount, token_idx: token_index},
        )
            .try_to_vec()
            .unwrap(),
    }
}

pub fn attest_icco_sale(
    program_id: Pubkey,
    sale_id: u128,
    payer: Pubkey,
    vaa_message: Pubkey,    // initSale, claimed
    attest_message: Pubkey,    // vaa to be created for conductor (signer keypair)
//    emitter: Pubkey,
) -> Instruction {
    // icco
    let config_key = ConfigAccount::<'_, { AccountState::Initialized }>::key(None, &program_id);
    let state_key = SaleStateAccount::<'_, { AccountState::Initialized }>::key(&SaleStateAccountDerivationData{sale_id: sale_id}, &program_id);
    // bridge
    let wormhole = wormhole_sdk::id();
    let wormhole_config = config(&wormhole);
    let fee_collector = fee_collector(&wormhole);
    let (emitter, _, _) = emitter(&program_id);
    let sequence = sequence(&wormhole, &emitter);

    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new_readonly(vaa_message, false),
            AccountMeta::new(attest_message, true),    // new vaa, signer
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            // Non-struct icco accounts:
            AccountMeta::new(state_key, false),
            // needed to post_vaa:
            AccountMeta::new(wormhole_config, false),
            AccountMeta::new(fee_collector, false),
            AccountMeta::new_readonly(emitter, false),
            AccountMeta::new(sequence, false),
            AccountMeta::new_readonly(wormhole, false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ],
        data: (
            crate::instruction::Instruction::AttestIccoSale,
            AttestIccoSaleData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}
