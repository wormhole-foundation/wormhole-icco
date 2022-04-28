#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use core::convert::TryInto;
//use std::mem::size_of_val;

use std::{
    error::Error,
    io::{
        Cursor,
        Read,
        Write,
    },
    // str::Utf8Error,
    // string::FromUtf8Error,
};

use byteorder::{
    BigEndian,
    ReadBytesExt,
    WriteBytesExt,
};

use crate::{
    messages::SaleInit,
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
    // program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
};

use solitaire::{
    SolitaireError,
    CreationLamports::Exempt,
    *,
};

use wormhole_sdk::{VAA};

use bridge::{
    vaa::{
        ClaimableVAA,
        DeserializePayload,
        PayloadMessage,
    },
    error::Error::{
//        VAAAlreadyExecuted,
//        VAAInvalid,
    },

    CHAIN_ID_SOLANA,
};



#[derive(FromAccounts)]
pub struct InitIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,       // Must be created before Init
    pub sale_state: Mut<SaleStateAccount<'b, { AccountState::MaybeInitialized }>>,   // Must not be created yet
    // TBD
    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,
    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
}

impl<'a> From<&InitIccoSale<'a>> for SaleStateDerivationData {
    fn from(accs: &InitIccoSale<'a>) -> Self {
        SaleStateDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}

// No data so far. All is in VAA Account
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct InitIccoSaleData {
}

// impl<'b> InstructionContext<'b> for InitIccoSale<'b> {
// }

pub fn init_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut InitIccoSale,
    _data: InitIccoSaleData,
) -> Result<()> {
    msg!("bbrp in init_icco_sale!");

    if accs.init_sale_vaa.payload_id != 1 {
        msg!("bbrp init_icco_sale bad payloadId");
        return Err(VAAInvalidPayloadId.into());
    }

    if accs.init_sale_vaa.meta().emitter_chain != 2 {
        msg!("bbrp init_icco_sale bad VAA emitter chain");
        return Err(VAAInvalidEmitterChain.into());
    }


    let now_time = accs.clock.unix_timestamp;
    let start_time = accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    let end_time = accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).1 as i64;
    msg!("time: {:?} start: {:?} end: {:?}", now_time, start_time, end_time);


    let sale_id = accs.init_sale_vaa.sale_id;
    msg!("sale_id: {:?}", sale_id);

    // Verify that the sale_state account PDA was derived correctly
    let derivation_data: SaleStateDerivationData = (&*accs).into();
    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;
    // msg!("state_key: {:?}", accs.sale_state.info().key);

    // Create sale_state account. (it was Uninitialized coming in)
    if !accs.sale_state.is_initialized() {
        accs.sale_state.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;
    }

    // [Ckeck if all Solana tokens exist.] Custodian accounts are created on first contribution to each token. As well as contribution info PDA Account.

    // If all good - Prevent vaa double processing
    // msg!("init_sale_vaa claim chain  {:?}", accs.init_sale_vaa.message.meta().emitter_chain);
    // msg!("init_sale_vaa claim  {:?}", accs.init_sale_vaa.claim.info().key);
    accs.init_sale_vaa.verify(ctx.program_id)?;
    accs.init_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}
