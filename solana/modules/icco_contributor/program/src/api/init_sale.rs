#![allow(dead_code)]
//#![allow(unused_must_use)]
//#![allow(unused_imports)]

use crate::{
    messages::SaleInit,
    simple_account::create_simple_account,
        accounts::{
        ConfigAccount,
        SaleStateAccount,
        SaleStateAccountDerivationData,
        CustodyAccount,
        CustodyAccountDerivationData,
    },
    errors::Error::*,
    types::*,
};

use solana_program::msg;

use solana_program::{
    // pubkey::Pubkey,
    // system_instruction,
    account_info::AccountInfo,
    // program::invoke,
    program::invoke_signed,
    // program_error::ProgramError,
    // pubkey::Pubkey,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
};

use solitaire::{
    CreationLamports::Exempt,
    *,
};

use bridge::{
    vaa::{
        ClaimableVAA,
    },
//    CHAIN_ID_SOLANA,
};


#[derive(FromAccounts)]
pub struct CreateIccoSaleCustodyAccount<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,       // Must be created before Init

    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,      // S/B unclaimed and stays unclaimed.

//    pub mint: Mut<Data<'b, SplMint, { AccountState::Initialized }>>,        // From token
    pub mint: Data<'b, SplMint, { AccountState::MaybeInitialized }>,        // From token

    pub custody: Mut<CustodyAccount<'b, { AccountState::MaybeInitialized }>>,

    pub prog_id: AccountInfo<'b>,

    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
    // Account [11] is the test.
}

impl<'a> From<&CreateIccoSaleCustodyAccount<'a>> for CustodyAccountDerivationData {
    fn from(accs: &CreateIccoSaleCustodyAccount<'a>) -> Self {
        CustodyAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
            mint: *accs.mint.info().key,
        }
    }
}

// No data so far. All is in VAA Account
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct CreateIccoSaleCustodyAccountData {
}


pub fn create_icco_sale_custody_account(
    ctx: &ExecutionContext,
    accs: &mut CreateIccoSaleCustodyAccount,
    _data: CreateIccoSaleCustodyAccountData,
) -> Result<()> {
    msg!("bbrp in create_icco_sale_escrow!");

//    accs.init_sale_vaa.verify(ctx.program_id)?;

    if accs.init_sale_vaa.payload_id != 1 {
        msg!("bbrp create_icco_sale_escrow! bad payloadId");
        return Err(VAAInvalidPayloadId.into());
    }

    if accs.init_sale_vaa.meta().emitter_chain != 2 {
        msg!("bbrp create_icco_sale_escrow! bad VAA emitter chain");
        return Err(VAAInvalidEmitterChain.into());
    }

    let sale_id = accs.init_sale_vaa.sale_id;
    msg!("sale_id: {:?}", sale_id);

    // Create and init custody account as needed. It may be initialized already, if previous init sale failed after accounts were created.
    // https://github.com/certusone/wormhole/blob/1792141307c3979b1f267af3e20cfc2f011d7051/solana/modules/token_bridge/program/src/api/transfer.rs#L159
    if !accs.custody.is_initialized() {
        accs.custody.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;
        let init_ix = spl_token::instruction::initialize_account(
            &spl_token::id(),
            accs.custody.info().key,
            accs.mint.info().key,
//            accs.payer.info().key,
            ctx.program_id,
        )?;
        invoke_signed(&init_ix, ctx.accounts, &[])?;
    }

    Ok(())
}


#[derive(FromAccounts)]
pub struct InitIccoSale<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,       // Must be created before Init
    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,  // Claimed here.

    pub rent: Sysvar<'b, Rent>,
    pub clock: Sysvar<'b, Clock>,
    // Sale state is in ctx.accounts[7];
}

/*
// May need this later Just for PDA verification.
impl<'a> From<&InitIccoSale<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &InitIccoSale<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}
*/

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

    accs.init_sale_vaa.verify(ctx.program_id)?;

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
/* BEFORE
    // Verify that the sale_state account PDA was derived correctly
    let derivation_data: SaleStateDerivationData = (&*accs).into();
    accs.sale_state.verify_derivation(ctx.program_id, &derivation_data)?;
    // msg!("state_key: {:?}", accs.sale_state.info().key);

    // [Check if all Solana tokens exist??] Custodian accounts are created before this call.
*/
    // Create account using Solana API.
    msg!("ctx accounts Cnt: {}", ctx.accounts.len());
    let sale_state_account_info = &ctx.accounts[7];
    
    if **sale_state_account_info.lamports.borrow() > 0 {
        return Err(SaleStateIsAlredyInitialized.into());
    } else {
        create_simple_account (ctx,
            sale_state_account_info.key,
            accs.payer.key,
            2 + 8 * accs.init_sale_vaa.token_cnt as usize,
            &SaleStateAccount::<'_, { AccountState::Uninitialized }>::seeds(&SaleStateAccountDerivationData{sale_id: sale_id}
        ))?;
    }
    
    // If all good - Prevent vaa double processing
    accs.init_sale_vaa.claim(ctx, accs.payer.key)?;

    Ok(())
}

