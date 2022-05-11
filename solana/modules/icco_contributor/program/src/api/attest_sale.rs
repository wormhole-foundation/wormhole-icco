#![allow(dead_code)]
//#![allow(unused_must_use)]
//#![allow(unused_imports)]

use crate::{
    messages::*,
    accounts::{
        ConfigAccount,
//        SaleStateAccountDerivationData,
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

use wormhole_sdk::{
    ConsistencyLevel,
    post_message,    // SDK call.
//    id as bridge_id,              // Get Bridge Id
};

//use bridge::{  vaa::{ ClaimableVAA, }, };


#[derive(FromAccounts)]
pub struct AttestIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub init_sale_vaa: ClaimedVAA<'b, SaleInit>,           // Was claimed.
    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
    // Sale state is in ctx.accounts[5];
}

/*
// May need this later Just for PDA verification.
impl<'a> From<&AttestIccoSale<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &AttestIccoSale<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.attest_sale_vaa.sale_id,
        }
    }
}
*/

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct AttestIccoSaleData {
}

pub fn attest_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut AttestIccoSale,
    _data: AttestIccoSaleData,
) -> Result<()> {
    msg!("bbrp in attest_icco_sale!");

    // let now_time = accs.clock.unix_timestamp;
    // let start_time = accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // let end_time = accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    // msg!("time: {:?} start: {:?} end: {:?}", now_time, start_time, end_time);

    // Verify that the sale_state account PDA was derived correctly
//    let sale_id = accs.init_sale_vaa.sale_id;
//    let derivation_data: SaleStateAccountDerivationData = (&*accs).into();
//    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;

    let sale_state_account_info = &ctx.accounts[5];
    let state_data = sale_state_account_info.data.borrow();
    if get_sale_state_sealed(&state_data) {
        return Err(SaleHasBeenSealed.into());
    }
    if get_sale_state_aborted(&state_data) {
        return Err(SaleHasBeenAborted.into());
    }

    // Let's count solana tokens.
    let mut sol_cnt: u8 = 0;
    let mut token_idx: u8 = 0;
    while token_idx < accs.init_sale_vaa.token_cnt {
        if accs.init_sale_vaa.get_accepted_token_chain(token_idx, &accs.init_sale_vaa.meta().payload) == 1 {
            sol_cnt = sol_cnt+1;
        }
        token_idx = token_idx + 1;
    }
    // Allocate and fill the VAA payload.
    let mut vaa_bf = Vec::with_capacity(sol_cnt as usize);   // even 0 should be ok
    let mut bf = & mut vaa_bf;
    pack_sale_attested_vaa_header(& mut bf, accs.init_sale_vaa.sale_id, sol_cnt);

    // Store solana amounts.
    sol_cnt = 0;
    token_idx = 0;
//    let amount: u64 = 0;
    while token_idx < accs.init_sale_vaa.token_cnt {
        if accs.init_sale_vaa.get_accepted_token_chain(token_idx, &accs.init_sale_vaa.meta().payload) == 1 {
            let amount = get_sale_state_contribution(&state_data, token_idx);
            pack_sale_attested_vaa_token(& mut bf, token_idx, sol_cnt, amount);
            sol_cnt = sol_cnt+1;
        }
        token_idx = token_idx + 1;
    }

    // post sale_attested_vaa.
    post_message(
        *ctx.program_id,
        *accs.payer.key,
        *accs.payer.key,
        &bf,
        ConsistencyLevel::Confirmed,
        None,       //Some(&seeds),  // If needed.
        ctx.accounts,
        0
    )?;

    Ok(())
}
