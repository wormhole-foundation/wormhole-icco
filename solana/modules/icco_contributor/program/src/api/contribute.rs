#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use std::mem::size_of_val;
use crate::{
    messages::SaleInit,
    accounts::{
        ConfigAccount,
        SaleStateAccount,
        SaleStateDerivationData,
    }
//    types::*,
};

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    // program_error::ProgramError,
    pubkey::Pubkey,
};
use solitaire::{
    CreationLamports::Exempt,
    *,
};

//use wormhole_sdk::{VAA};

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
pub struct ContributeIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,      // Must be created by now
    pub sale_state: SaleStateAccount<'b, { AccountState::Initialized }>,   // Must not be created yet
    // TBD
    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,           // Was claimed.
    // pub SaleVaa: Data<'b, SplAccount, { AccountState::Initialized }>
    // pub from: Mut<Data<'b, SplAccount, { AccountState::Initialized }>>,
    // pub mint: Mut<Data<'b, SplMint, { AccountState::Initialized }>>,
    // pub custody: Mut<CustodyAccount<'b, { AccountState::MaybeInitialized }>>,
    // pub clock: Sysvar<'b, Clock>,
}

impl<'a> From<&ContributeIccoSale<'a>> for SaleStateDerivationData {
    fn from(accs: &ContributeIccoSale<'a>) -> Self {
        SaleStateDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}


#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct ContributeIccoSaleData {
}

impl<'b> InstructionContext<'b> for ContributeIccoSale<'b> {
}

pub fn contribute_icco_sale(
    _ctx: &ExecutionContext,
    _accs: &mut ContributeIccoSale,
    _data: ContributeIccoSaleData,
) -> Result<()> {
    msg!("bbrp in contribute_icco_sale!");



    // code to create custordy account as needed.
    // https://github.com/certusone/wormhole/blob/1792141307c3979b1f267af3e20cfc2f011d7051/solana/modules/token_bridge/program/src/api/transfer.rs#L159

    // if !accs.custody.is_initialized() {
    //     accs.custody
    //         .create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;

    //     let init_ix = spl_token::instruction::initialize_account(
    //         &spl_token::id(),
    //         accs.custody.info().key,
    //         accs.mint.info().key,
    //         accs.custody_signer.key,
    //     )?;
    //     invoke_signed(&init_ix, ctx.accounts, &[])?;
    // }

    Ok(())
}
