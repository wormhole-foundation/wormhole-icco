#![allow(dead_code)]
//#![allow(unused_must_use)]
//#![allow(unused_imports)]

use std::convert::TryInto;

use crate::{
    messages::*,
    accounts::{
        CustodyAccount,
        ConfigAccount,
        SaleStateAccountDerivationData,
        CustodyAccountDerivationData,    },
    instructions:: {
        get_icco_sale_custody_account_address_for_sale_token,
     },
    errors::Error::*,
    claimed_vaa::ClaimedVAA,
    types::*,
};

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
    program::{
        invoke_signed,
    },
};

use bridge::{
    vaa::{
        ClaimableVAA,
    },
//    CHAIN_ID_SOLANA,
};

use token_bridge:: {
    instructions:: {
        transfer_native as wh_transfer_native,
        transfer_wrapped as wh_transfer_wrapped,
    },
    TransferNativeData,
    TransferWrappedData,
};

use wormhole_sdk::{
    id as core_bridge_id,
};

use solitaire::{
//    CreationLamports::Exempt,
    *,
};

//use wormhole_sdk::{
//    ConsistencyLevel,
//    post_message,    // SDK call.
//    id as bridge_id,              // Get Bridge Id
//};

//use bridge::{  vaa::{ ClaimableVAA, }, };


// Seal sale is Two stage process.
// 1. Process and claim sealSale VAA.
//      seal_sale
// 2. Transfer all or part of tokens from custody accounts to the conductor chain accounts.
//      TransferCustodyIccoToken


// Step 1 contract call: TransferCustodyIccoTokens, called for each accetpted token on this chain.

#[derive(FromAccounts)]
pub struct SealIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub seal_sale_vaa: ClaimableVAA<'b, SaleSealed>,
    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
    // Sale state is in ctx.accounts[7];
}

/*
// May need this later Just for PDA verification.
impl<'a> From<&SealIccoSale<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &SealIccoSale<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.seal_sale_vaa.sale_id,
        }
    }
}
*/

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct SealIccoSaleData {
}

pub fn seal_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut SealIccoSale,
    _data: SealIccoSaleData,
) -> Result<()> {
    msg!("bbrp in seal_icco_sale!");

    accs.seal_sale_vaa.verify(ctx.program_id)?;

    if accs.seal_sale_vaa.payload_id != 3 {
        return Err(VAAInvalidPayloadId.into());
    }

    if accs.seal_sale_vaa.meta().emitter_chain != 2 {
        return Err(VAAInvalidEmitterChain.into());
    }

    // let now_time = accs.clock.unix_timestamp;
    // let start_time = accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // let end_time = accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // msg!("time: {:?} start: {:?} end: {:?}", now_time, start_time, end_time);

    // Verify that the sale_state account PDA was derived correctly
//    let sale_id = accs.init_sale_vaa.sale_id;
//    let derivation_data: SaleStateAccountDerivationData = (&*accs).into();
//    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;
    let sale_state_account_info = &ctx.accounts[7];
    //msg!("state_key: {:?}", sale_state_account_info.key);

    let mut state_data = sale_state_account_info.data.borrow_mut();
    if get_sale_state_sealed(&state_data) {
        return Err(SaleHasBeenSealed.into());
    }
    if get_sale_state_aborted(&state_data) {
        return Err(SaleHasBeenAborted.into());
    }

    set_sale_state_sealed(& mut state_data, true);
    accs.seal_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}



// Step 2 contract call: TransferCustodyIccoTokens, called for each accetpted token on this chain.
// Checks if saleToken custody account has expected amount.
// Transfers accepted tokens from one custody account to conductor chain account via WH
// SaleToken custody account was created in initSale call.
#[derive(FromAccounts)]
pub struct TransferCustodyIccoToken<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub init_sale_vaa: ClaimedVAA<'b, InitSale>,           // Was claimed.
    pub seal_sale_vaa: ClaimedVAA<'b, SaleSealed>,           // Was NOT claimed yet ??
    pub message: Mut<Signer<AccountInfo<'b>>>,          // Transfer  VAA account.
    pub sale_custody: Mut<CustodyAccount<'b, { AccountState::Initialized }>>,       // To check if sale token account has expected amount.
    pub sale_custody_mint: Data<'b, SplMint, { AccountState::Initialized }>,        // To check if sale token account has expected amount.
    pub token_custody: Mut<CustodyAccount<'b, { AccountState::Initialized }>>,      // Custody account to transfer tokens from to the seller.
    pub token_mint: Data<'b, SplMint, { AccountState::Initialized }>,        // From token Why Mut??

    pub clock: Sysvar<'b, Clock>,

    // Sale state is in ctx.accounts        [10];
    
    // AccountMeta::new_readonly(core_bridge, false),   // Use addr from SDK
    // AccountMeta::new_readonly(token_bridge, false),

    // --- starting here Needed for WH transfer, not used here.
    // AccountMeta::new(wormhole_config, false),
    // AccountMeta::new(fee_collector, false),
    // AccountMeta::new_readonly(emitter, false),
    // AccountMeta::new(sequence, false),
    // AccountMeta::new_readonly(solana_program::system_program::id(), false),
}

impl<'a> From<&TransferCustodyIccoToken<'a>> for CustodyAccountDerivationData {
    fn from(accs: &TransferCustodyIccoToken<'a>) -> Self {
        CustodyAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
            mint: *accs.token_mint.info().key,
        }
    }
}

// May need this later for PDA verification.
impl<'a> From<&TransferCustodyIccoToken<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &TransferCustodyIccoToken<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct SealIccoSaleTransferCustodyIccoTokenData {
    pub token_idx: u8,
}

pub fn seal_icco_sale_transfer_custody(
    ctx: &ExecutionContext,
    accs: &mut TransferCustodyIccoToken,
    data: SealIccoSaleTransferCustodyIccoTokenData,
) -> Result<()> {
    msg!("bbrp in seal_icco_sale_transfer_custody");

    // let now_time = accs.clock.unix_timestamp;
    // let start_time = accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // let end_time = accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // msg!("time: {:?} start: {:?} end: {:?}", now_time, start_time, end_time);

    // Verify that the sale_state account PDA was derived correctly
//    let sale_id = accs.init_sale_vaa.sale_id;
//    let derivation_data: SaleStateAccountDerivationData = (&*accs).into();
//    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;

    // msg!("state: {:?}", ctx.accounts[6].key);
    let token_idx = data.token_idx;
    let sale_state_account_info = &ctx.accounts[10];
    let state_data = sale_state_account_info.data.borrow();
    if !get_sale_state_sealed(&state_data) {
        // msg!("not sealed!");
        return Err(SaleHasNotBeenSealed.into());
    }
    if get_sale_state_aborted(&state_data) {
        // msg!("aborted!");
        return Err(SaleHasBeenAborted.into());
    }

    // Verify that saleCustody ATA address is corect and verify/create account it exists and owned by this contract.
    {
        let sale_token_dk = get_icco_sale_custody_account_address_for_sale_token(*ctx.program_id, InitSale::get_token_address_bytes(&accs.init_sale_vaa.meta().payload[..]).try_into().unwrap());
        if sale_token_dk != *accs.sale_custody.info().key {
            msg!("bbrp init_icco_sale bad sale_token_address {:?} / {:?}", sale_token_dk, *accs.sale_custody.info().key );
            return Err(SaleTokenAccountAddressIncorrect.into());
        }
    }

    // TBD Check saleToken if custody account has expected amount.
    if accs.sale_custody.amount == 0 {
        return Err(SaleTokenCustodyAccountEmpty.into());
    }

    // Check if this token was transferred already.
    // msg!("pre-transfer check");
    let sale_state_account_info = &ctx.accounts[12];
    let mut state_data = sale_state_account_info.data.borrow_mut();

    if get_sale_state_contribution_transferred(&state_data, token_idx) {
        // This custody account was processed already.
        return Ok(());
    }
    let is_native: bool = true;

    let ix = if is_native {
        wh_transfer_native(
            *ctx.accounts[10].info().key, // tokenBridge
            core_bridge_id(),  // CoreBridge
            *accs.payer.key,
            *accs.message.key,
            *accs.sale_custody.info().key,
            *accs.sale_custody_mint.info().key,
            TransferNativeData {
                nonce: 0,  //nonce,
                amount: accs.token_custody.amount, // amount,   // TBD! Needs to be prorated!
                fee: 0, //fee,
                target_address: accs.init_sale_vaa.get_sale_recepient_bytes(&accs.init_sale_vaa.meta().payload[..]),     //target_address: target_addr,
                target_chain: InitSale::get_token_chain(&accs.init_sale_vaa.meta().payload[..]),     // target_chain,
            },
        ).unwrap()
    } else {
        wh_transfer_wrapped(
            *ctx.accounts[10].info().key, // tokenBridge
            core_bridge_id(),  // CoreBridge
            *accs.payer.key,
            *accs.message.key,
            *accs.sale_custody.info().key,      // from
            *accs.sale_custody_mint.info().key, // from owner?
            InitSale::get_token_chain(&accs.init_sale_vaa.meta().payload[..]),     // TBD! token_address: ForeignAddress,
            accs.init_sale_vaa.get_sale_recepient_bytes(&accs.init_sale_vaa.meta().payload[..]),     // TBD! token_chain: u16,
            TransferWrappedData {
                nonce: 0,  //nonce,
                amount: accs.token_custody.amount, // amount,   // TBD! Needs to be prorated!
                fee: 0, //fee,
                target_address: accs.init_sale_vaa.get_sale_recepient_bytes(&accs.init_sale_vaa.meta().payload[..]),     //target_address: target_addr,
                target_chain: InitSale::get_token_chain(&accs.init_sale_vaa.meta().payload[..]),     // target_chain,
            },
        ).unwrap()
    };

    invoke_signed(&ix, ctx.accounts, &[])?;

    // Mark this token as transferred.
    set_sale_state_contribution_transferred(&mut state_data, token_idx, true);

    Ok(())
}
