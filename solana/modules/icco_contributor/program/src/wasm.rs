#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use crate::{
    messages::{
        InitSale,
    },
    accounts::{
        AuthoritySigner,
        CustodySigner,
        EmitterAccount
    },
    instructions::{
        create_icco_sale_custody_account,
        get_icco_sale_custody_account_address,
        get_icco_sale_custody_account_address_for_sale_token,
        get_icco_sale_mint_address_for_sale_token,
            //    get_test_account_address,
        get_icco_state_address,
        init_icco_sale,
        abort_icco_sale,
        contribute_icco_sale,
        attest_icco_sale,
        seal_icco_sale,
        seal_icco_sale_transfer_custody,
        claim_refund_icco_sale,
    },
    types::{
        EndpointRegistration,
//        WrappedMeta
    },
};
use borsh::BorshDeserialize;
use bridge::{
    accounts::PostedVAADerivationData, instructions::hash_vaa, vaa::VAA, DeserializePayload,
    PostVAAData,
};
use solana_program::pubkey::Pubkey;
use solitaire::{processors::seeded::Seeded, AccountState};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

/*
#[wasm_bindgen]
pub fn upgrade_contract_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    spill: String,
    vaa: Vec<u8>,
) -> JsValue {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let spill = Pubkey::from_str(spill.as_str()).unwrap();
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let payload = GovernancePayloadUpgrade::deserialize(&mut vaa.payload.as_slice()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = upgrade_contract(
        program_id,
        Pubkey::from_str(payer.as_str()).unwrap(),
        message_key,
        Pubkey::new(&vaa.emitter_address),
        payload.new_contract,
        spill,
        vaa.sequence,
    );
    return JsValue::from_serde(&ix).unwrap();
}

#[wasm_bindgen]
pub fn register_chain_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    vaa: Vec<u8>,
) -> JsValue {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let payer = Pubkey::from_str(payer.as_str()).unwrap();
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let payload = PayloadGovernanceRegisterChain::deserialize(&mut vaa.payload.as_slice()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let post_vaa_data = PostVAAData {
        version: vaa.version,
        guardian_set_index: vaa.guardian_set_index,
        timestamp: vaa.timestamp,
        nonce: vaa.nonce,
        emitter_chain: vaa.emitter_chain,
        emitter_address: vaa.emitter_address,
        sequence: vaa.sequence,
        consistency_level: vaa.consistency_level,
        payload: vaa.payload,
    };
    let ix = register_chain(
        program_id,
        bridge_id,
        payer,
        message_key,
        post_vaa_data,
        payload,
        RegisterChainData {},
    )
    .unwrap();
    return JsValue::from_serde(&ix).unwrap();
}
*/

#[wasm_bindgen]
pub fn emitter_address(program_id: String) -> Vec<u8> {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let emitter = EmitterAccount::key(None, &program_id);

    emitter.to_bytes().to_vec()
}

#[wasm_bindgen]
pub fn custody_signer(program_id: String) -> Vec<u8> {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let custody_signer = CustodySigner::key(None, &program_id);

    custody_signer.to_bytes().to_vec()
}

#[wasm_bindgen]
pub fn approval_authority_address(program_id: String) -> Vec<u8> {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let approval_authority = AuthoritySigner::key(None, &program_id);

    approval_authority.to_bytes().to_vec()
}

#[wasm_bindgen]
pub fn parse_endpoint_registration(data: Vec<u8>) -> JsValue {
    JsValue::from_serde(&EndpointRegistration::try_from_slice(data.as_slice()).unwrap()).unwrap()
}

#[wasm_bindgen]
pub fn vaa_address(bridge_id: String, vaa: Vec<u8>) -> Vec<u8> {
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    message_key.to_bytes().to_vec()
}

/*
#[wasm_bindgen]
pub fn test_account_address(program_id: String, sale_id: u64) -> Pubkey {
    get_test_account_address (Pubkey::from_str(program_id.as_str()).unwrap(), sale_id as u128)
}
*/

#[wasm_bindgen]
pub fn icco_state_address(program_id: String, sale_id: u64) -> Pubkey {
    get_icco_state_address (Pubkey::from_str(program_id.as_str()).unwrap(), sale_id as u128)
}

#[wasm_bindgen]
pub fn icco_sale_custody_account_address(program_id: String, sale_id: u64, mint: String) -> Pubkey {
    get_icco_sale_custody_account_address (Pubkey::from_str(program_id.as_str()).unwrap(), sale_id as u128, Pubkey::from_str(mint.as_str()).unwrap())
}


#[wasm_bindgen]
pub fn create_icco_sale_custody_account_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    vaa: Vec<u8>,
    token_mint: String,
    token_index: u8,
) -> JsValue {
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let token_mint = Pubkey::from_str(token_mint.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = create_icco_sale_custody_account(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        message_key,
        Pubkey::new(&vaa.emitter_address),
        vaa.emitter_chain,
        vaa.sequence,
        token_mint,
        token_index,
        );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn init_icco_sale_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    vaa: Vec<u8>,
    token_mint: String,
) -> JsValue {
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = init_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        message_key,
        Pubkey::new(&vaa.emitter_address),
        vaa.emitter_chain,
        vaa.sequence,
        &InitSale::get_token_address_bytes(&vaa.payload),
        Pubkey::from_str(token_mint.as_str()).unwrap(),
    );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn abort_icco_sale_ix(
    program_id: String,
    core_bridge_id: String,
    payer: String,
    vaa: Vec<u8>,
) -> JsValue {
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let core_bridge_id = Pubkey::from_str(core_bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &core_bridge_id,
    );
    let ix = abort_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        message_key,
        Pubkey::new(&vaa.emitter_address),
        vaa.emitter_chain,
        vaa.sequence,
    );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn seal_icco_sale_ix(
    program_id: String,
    core_bridge_id: String,
    payer: String,
    vaa: Vec<u8>,
) -> JsValue {
    let vaa = VAA::deserialize(vaa.as_slice()).unwrap();
    let core_bridge_id = Pubkey::from_str(core_bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &core_bridge_id,
    );
    let ix = seal_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        message_key,
        Pubkey::new(&vaa.emitter_address),
        vaa.emitter_chain,
        vaa.sequence,
    );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn seal_icco_sale_transfer_custody_ix(
    program_id: String,
    core_bridge_id: String,
    payer: String,
    token_index: u8,
    custody_token_mint: String,
    init_sale_vaa: Vec<u8>,
    seal_sale_vaa: Vec<u8>,
    xfer_vaa: String,
    wrapped_sale_token_mint: String,
    token_bridge: String,
) -> JsValue {
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let core_bridge_id = Pubkey::from_str(core_bridge_id.as_str()).unwrap();

    let init_sale_vaa = VAA::deserialize(init_sale_vaa.as_slice()).unwrap();
    let init_sale_vaa_message = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&init_sale_vaa.clone().into()).to_vec(),
        },
        &core_bridge_id,
    );

    let seal_sale_vaa = VAA::deserialize(seal_sale_vaa.as_slice()).unwrap();
    let seal_sale_vaa_message = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&seal_sale_vaa.clone().into()).to_vec(),
        },
        &core_bridge_id,
    );

    let ix = seal_icco_sale_transfer_custody(
        program_id,
        InitSale::get_init_sale_sale_id(&init_sale_vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        token_index,
        &InitSale::get_token_address_bytes(&init_sale_vaa.payload),     // Foreign, from initSale VAA
        Pubkey::from_str(custody_token_mint.as_str()).unwrap(),
        Pubkey::from_str(token_bridge.as_str()).unwrap(),
        init_sale_vaa_message,
        seal_sale_vaa_message,
        Pubkey::from_str(xfer_vaa.as_str()).unwrap(),      // vaa to be created for tokenBridge (new keypair)
        Pubkey::from_str(wrapped_sale_token_mint.as_str()).unwrap(),
    );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn contribute_icco_sale_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    from_account: String,
    init_sale_vaa: Vec<u8>,
    token_mint: String,
    token_index: u8,
    amount: u64,
) -> JsValue {
    let vaa = VAA::deserialize(init_sale_vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let from_account = Pubkey::from_str(from_account.as_str()).unwrap();
    let token_mint = Pubkey::from_str(token_mint.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = contribute_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        from_account,
        message_key,
        token_mint,
        token_index,
        amount,
    );
    JsValue::from_serde(&ix).unwrap()
}



#[wasm_bindgen]
pub fn claim_refund_icco_sale_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    from_account: String,
    init_sale_vaa: Vec<u8>,
    token_mint: String,
    token_index: u8,
) -> JsValue {
    let vaa = VAA::deserialize(init_sale_vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let from_account = Pubkey::from_str(from_account.as_str()).unwrap();
    let token_mint = Pubkey::from_str(token_mint.as_str()).unwrap();
    let message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = claim_refund_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        from_account,
        message_key,
        token_mint,
        token_index,
    );
    JsValue::from_serde(&ix).unwrap()
}


#[wasm_bindgen]
pub fn attest_icco_sale_ix(
    program_id: String,
    bridge_id: String,
    payer: String,
    init_sale_vaa: Vec<u8>,         // initSale
    attest_vaa: String,
) -> JsValue {
    let i_s_vaa = VAA::deserialize(init_sale_vaa.as_slice()).unwrap();
    let bridge_id = Pubkey::from_str(bridge_id.as_str()).unwrap();
    let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
    let init_sale_message_key = bridge::accounts::PostedVAA::<'_, { AccountState::Uninitialized }>::key(
        &PostedVAADerivationData {
            payload_hash: hash_vaa(&i_s_vaa.clone().into()).to_vec(),
        },
        &bridge_id,
    );
    let ix = attest_icco_sale(
        program_id,
        InitSale::get_init_sale_sale_id(&i_s_vaa.payload),
        Pubkey::from_str(payer.as_str()).unwrap(),
        init_sale_message_key,
        Pubkey::from_str(attest_vaa.as_str()).unwrap(),
//        program_id,
    );
    JsValue::from_serde(&ix).unwrap()
}

#[wasm_bindgen]
pub fn icco_sale_custody_account_address_for_sale_token(program_id: String, src_mint: Vec<u8>) -> Pubkey {
    let mut t_addr = [0u8; 32];
    t_addr.copy_from_slice(&src_mint);
    get_icco_sale_custody_account_address_for_sale_token (Pubkey::from_str(program_id.as_str()).unwrap(), t_addr)
}

#[wasm_bindgen]
pub fn icco_sale_mint_address_for_sale_token(program_id: String, src_chain: u16, src_mint: Vec<u8>) -> Pubkey {
    let mut t_addr = [0u8; 32];
    t_addr.copy_from_slice(&src_mint);
    get_icco_sale_mint_address_for_sale_token (Pubkey::from_str(program_id.as_str()).unwrap(), t_addr, src_chain)
}

// Dealing with non-Pubkey addresses.
// #[wasm_bindgen]
// pub fn wrapped_address(program_id: String, token_address: Vec<u8>, token_chain: u16) -> Vec<u8> {
//     let program_id = Pubkey::from_str(program_id.as_str()).unwrap();
//     let mut t_addr = [0u8; 32];
//     t_addr.copy_from_slice(&token_address);

//     let wrapped_addr = WrappedMint::<'_, { AccountState::Initialized }>::key(
//         &WrappedDerivationData {
//             token_address: t_addr,
//             token_chain,
//         },
//         &program_id,
//     );

//     wrapped_addr.to_bytes().to_vec()
// }

// impl<'b, const State: AccountState> Seeded<&WrappedDerivationData> for WrappedMint<'b, { State }> {
//     fn seeds(data: &WrappedDerivationData) -> Vec<Vec<u8>> {
//         vec![
//             String::from("wrapped").as_bytes().to_vec(),
//             data.token_chain.to_be_bytes().to_vec(),
//             data.token_address.to_vec(),
//         ]
//     }
// }

