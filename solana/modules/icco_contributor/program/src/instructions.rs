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
        InitIccoSaleData,
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
use spl_token::state::Mint;
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

/*
pub fn register_chain(
    program_id: Pubkey,
    bridge_id: Pubkey,
    payer: Pubkey,
    message_key: Pubkey,
    vaa: PostVAAData,
    payload: PayloadGovernanceRegisterChain,
    data: RegisterChainData,
) -> solitaire::Result<Instruction> {
    let config_key = ConfigAccount::<'_, { AccountState::Uninitialized }>::key(None, &program_id);
    let (message_acc, claim_acc) = claimable_vaa(program_id, message_key, vaa);
    let endpoint = Endpoint::<'_, { AccountState::Initialized }>::key(
        &EndpointDerivationData {
            emitter_chain: payload.chain,
            emitter_address: payload.endpoint_address,
        },
        &program_id,
    );

    Ok(Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(config_key, false),
            AccountMeta::new(endpoint, false),
            message_acc,
            claim_acc,
            // Dependencies
            AccountMeta::new(solana_program::sysvar::rent::id(), false),
            AccountMeta::new(solana_program::system_program::id(), false),
            // Program
            AccountMeta::new_readonly(bridge_id, false),
        ],
        data: (crate::instruction::Instruction::RegisterChain, data).try_to_vec()?,
    })
}
*/ 

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

/*
pub fn upgrade_contract(
    program_id: Pubkey,
    payer: Pubkey,
    payload_message: Pubkey,
    emitter: Pubkey,
    new_contract: Pubkey,
    spill: Pubkey,
    sequence: u64,
) -> Instruction {
    let claim = Claim::<'_, { AccountState::Uninitialized }>::key(
        &ClaimDerivationData {
            emitter_address: emitter.to_bytes(),
            emitter_chain: CHAIN_ID_SOLANA,
            sequence,
        },
        &program_id,
    );

    let (upgrade_authority, _) = Pubkey::find_program_address(&["upgrade".as_bytes()], &program_id);

    let (program_data, _) = Pubkey::find_program_address(
        &[program_id.as_ref()],
        &solana_program::bpf_loader_upgradeable::id(),
    );

    Instruction {
        program_id,

        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(payload_message, false),
            AccountMeta::new(claim, false),
            AccountMeta::new_readonly(upgrade_authority, false),
            AccountMeta::new(spill, false),
            AccountMeta::new(new_contract, false),
            AccountMeta::new(program_data, false),
            AccountMeta::new(program_id, false),
            AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
            AccountMeta::new_readonly(solana_program::bpf_loader_upgradeable::id(), false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
        ],

        data: (
            crate::instruction::Instruction::UpgradeContract,
            UpgradeContractData {},
        )
            .try_to_vec()
            .unwrap(),
    }
}
*/

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
    let state_key = SaleStateAccount::<'_, { AccountState::MaybeInitialized }>::key(&SaleStateDerivationData{sale_id: sale_id}, &program_id);
    msg!("state_key: {:?}", state_key);
    
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

