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

use bridge::{
    vaa::{
        ClaimableVAA,
    },
};


#[derive(FromAccounts)]
pub struct AbortIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub abort_sale_vaa: ClaimableVAA<'b, SaleAbort>,
    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
    // Sale state is in ctx.accounts[7];
}

/*
// May need this later Just for PDA verification.
impl<'a> From<&AbortIccoSale<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &AbortIccoSale<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.abort_sale_vaa.sale_id,
        }
    }
}
*/

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct AbortIccoSaleData {
}

pub fn abort_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut AbortIccoSale,
    _data: AbortIccoSaleData,
) -> Result<()> {
    msg!("bbrp in abort_icco_sale!");

    accs.abort_sale_vaa.verify(ctx.program_id)?;

    if accs.abort_sale_vaa.payload_id != 4 {
        return Err(VAAInvalidPayloadId.into());
    }

    if accs.abort_sale_vaa.meta().emitter_chain != 2 {
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

    set_sale_state_aborted(& mut state_data, true);
    accs.abort_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}
