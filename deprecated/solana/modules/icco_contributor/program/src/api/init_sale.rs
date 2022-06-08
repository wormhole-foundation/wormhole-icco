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
};

use crate:: {
    errors::Error::{
        VAAInvalidEmitterChain,
    }
};


use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    // program_error::ProgramError,
    pubkey::Pubkey,
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
        VAAAlreadyExecuted,
        VAAInvalid,
    },

    CHAIN_ID_SOLANA,
};



#[derive(FromAccounts)]
pub struct InitIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,       // Must be created before Init
    pub sale_state: SaleStateAccount<'b, { AccountState::Uninitialized }>,   // Must not be created yet
    // TBD
    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,
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
/*    if accs.init_sale_vaa.payloadID != 1 {
        msg!("bbrp init_icco_sale bad chain");
        return Err(VAAInvalidEmitterChain.into());
    }
    */

    // --- vvv This is just for testing.. Needs to go away.
//    let sale_id = accs.init_sale_vaa.get_sale_id(&accs.init_sale_vaa.meta().payload[..]);
    let sale_id = accs.init_sale_vaa.sale_id;
    if sale_id != 1 {
        msg!("bbrp init_icco_sale bad chain");
        return Err(VAAInvalidEmitterChain.into());
    }

    if accs.init_sale_vaa.meta().emitter_chain != 2 {
        msg!("bbrp init_icco_sale bad VAA emitter chain");
        return Err(VAAInvalidEmitterChain.into());
    }
    // --- ^^^ This is just for testing 

    // Create status account. (it was Uninitialized comind in)
    accs.sale_state.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;

    // Ckeck if all Solana tokens exist. Custodian accounts are created on first contribution to each token. As well as contribution info PDA Account.

    // If all good - Prevent vaa double processing
    accs.init_sale_vaa.verify(ctx.program_id)?;
    accs.init_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}
