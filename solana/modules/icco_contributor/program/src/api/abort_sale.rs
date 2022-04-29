#![allow(dead_code)]
//#![allow(unused_must_use)]
//#![allow(unused_imports)]

use crate::{
    messages::SaleAbort,
    accounts::{
        ConfigAccount,
        SaleStateAccount,
        SaleStateDerivationData,
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
    pub sale_state: Mut<SaleStateAccount<'b, { AccountState::Initialized }>>,
    pub abort_sale_vaa: ClaimableVAA<'b, SaleAbort>,
    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
}

impl<'a> From<&AbortIccoSale<'a>> for SaleStateDerivationData {
    fn from(accs: &AbortIccoSale<'a>) -> Self {
        SaleStateDerivationData {
            sale_id: accs.abort_sale_vaa.sale_id,
        }
    }
}

// No data so far.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct AbortIccoSaleData {
}

// impl<'b> InstructionContext<'b> for AbortIccoSale<'b> {
// }

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


    // let sale_id = accs.init_sale_vaa.sale_id;

    // Verify that the sale_state account PDA was derived correctly
    let derivation_data: SaleStateDerivationData = (&*accs).into();
    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;

    // sale_state account set 
    if accs.sale_state.is_sealed {
        return Err(SaleHasBeenSealed.into());
    }
    if accs.sale_state.is_aborted {
        return Err(SaleHasBeenAborted.into());
    }

    // Set sale as aborted and claim VAA on this chain
    accs.sale_state.is_aborted = true;
    accs.abort_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}
