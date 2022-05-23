#![allow(dead_code)]
//#![allow(unused_must_use)]
//#![allow(unused_imports)]

use crate::{
    messages::*,
    accounts::{
        CustodyAccount,
        ConfigAccount,
        SaleStateAccountDerivationData,
    },
    errors::Error::*,
    claimed_vaa::ClaimedVAA,
};

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
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
// 1. Transfer all or part of tokens from custody accounts to the conductor chain accounts.
// 2. Process and claim sealSale VAA.

// Step 1 contract call: TransferCustodyIccoTokens, called for each accetpted token on this chain.
// Checks if saleToken custody account has expected amount.
// Transfers accepted tokens from one custody account to conductor chain account via WH
// SaleToken custody account was created in initSale call.
#[derive(FromAccounts)]
pub struct TransferCustodyIccoTokenNative<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub init_sale_vaa: ClaimedVAA<'b, InitSale>,           // Was claimed.
    pub seal_sale_vaa: ClaimedVAA<'b, SaleSealed>,           // Was NOT claimed yet
    pub sale_custody: Mut<CustodyAccount<'b, { AccountState::Initialized }>>,      // To check if sale token account has expected amount.
    pub clock: Sysvar<'b, Clock>,

    // Sale state is in ctx.accounts[7];
    
    // --- starting here Needed for WH transfer.
    // AccountMeta::new(wormhole_config, false),
    // AccountMeta::new(fee_collector, false),
    // AccountMeta::new_readonly(emitter, false),
    // AccountMeta::new(sequence, false),
    // AccountMeta::new_readonly(wormhole, false),
    // AccountMeta::new_readonly(solana_program::system_program::id(), false),
}

// May need this later for PDA verification.
impl<'a> From<&TransferCustodyIccoTokenNative<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &TransferCustodyIccoTokenNative<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct AttestIccoSaleTransferCustodyIccoTokenData {
    pub token_idx: u8,
}

pub fn attest_icco_sale_transfer_native_custody(
    ctx: &ExecutionContext,
    _accs: &mut TransferCustodyIccoTokenNative,
    data: AttestIccoSaleTransferCustodyIccoTokenData,
) -> Result<()> {
    msg!("bbrp in attest_icco_sale_transfer_native_custody");

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
    let sale_state_account_info = &ctx.accounts[7];
    let state_data = sale_state_account_info.data.borrow();
    if !get_sale_state_sealed(&state_data) {
        // msg!("not sealed!");
        return Err(SaleHasNotBeenSealed.into());
    }
    if get_sale_state_aborted(&state_data) {
        // msg!("aborted!");
        return Err(SaleHasBeenAborted.into());
    }

    // TBD Check saleToken if custody account has expected amount.

    // Check if this token was transferred already.
    // msg!("pre-transfer check");
    let sale_state_account_info = &ctx.accounts[11];
    let mut state_data = sale_state_account_info.data.borrow_mut();

    if get_sale_state_contribution_transferred(&state_data, token_idx) {
        // This custody account was processed already.
        return Ok(());
    }

    // TBD token bridge native xfer.

    // Mark this token as transferred.
    set_sale_state_contribution_transferred(&mut state_data, token_idx, true);

    Ok(())
}
