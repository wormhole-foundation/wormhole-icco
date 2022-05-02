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
        CustodySigner,
        CustodyAccount,
        CustodyAccountDerivationData,
        ContributionStateAccount,
        ContributionStateAccountDerivationData,
        AuthoritySigner,
    },
    errors::Error::*,
    types::*,
};

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    // program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::clock::Clock,
    program::{
        invoke_signed,
    },
};

use solitaire::{
    CreationLamports::Exempt,
    *,
};

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
    pub init_sale_vaa: ClaimableVAA<'b, SaleInit>,           // Was claimed.

    pub contribution_state: ContributionStateAccount<'b, { AccountState::MaybeInitialized }>, 

    pub from: Mut<Data<'b, SplAccount, { AccountState::Initialized }>>,     // From account
    pub mint: Mut<Data<'b, SplMint, { AccountState::Initialized }>>,        // From token
    pub authority_signer: AuthoritySigner<'b>,

    pub custody_signer: CustodySigner<'b>,
    pub custody: Mut<CustodyAccount<'b, { AccountState::Initialized }>>, 

    pub clock: Sysvar<'b, Clock>,
}

impl<'a> From<&ContributeIccoSale<'a>> for SaleStateDerivationData {
    fn from(accs: &ContributeIccoSale<'a>) -> Self {
        SaleStateDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}

impl<'a> From<&ContributeIccoSale<'a>> for CustodyAccountDerivationData {
    fn from(accs: &ContributeIccoSale<'a>) -> Self {
        CustodyAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
            mint: *accs.mint.info().key,
        }
    }
}

impl<'a> From<&ContributeIccoSale<'a>> for ContributionStateAccountDerivationData {
    fn from(accs: &ContributeIccoSale<'a>) -> Self {
        ContributionStateAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
            contributor: *accs.from.info().key,
            token: *accs.mint.info().key,
        }
    }
}


#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct ContributeIccoSaleData {
    amount: u64,
    token_idx: u8,
}

impl<'b> InstructionContext<'b> for ContributeIccoSale<'b> {
}

pub fn contribute_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut ContributeIccoSale,
    data: ContributeIccoSaleData,
) -> Result<()> {
    msg!("bbrp in contribute_icco_sale!");

    // Check sale status.
    if accs.sale_state.is_sealed || accs.sale_state.is_aborted {
        return Err(SaleSealedOrAborted.into());
    }

    // Check if sale started.
    // require(block.timestamp >= start, "sale not yet started");
    // require(block.timestamp <= end, "sale has ended");
    let now_time = accs.clock.unix_timestamp as u128;       // i64 ->u128
    if now_time < accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).0 {
        return Err(SaleHasNotStarted.into());
    }
    if now_time > accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).0 {
        return Err(SaleHasEnded.into());
    }

    // Make sure token Idx matches passed in token mint addr.
    let token_idx = data.token_idx;
    if token_idx >= accs.init_sale_vaa.token_cnt {
        return Err(InvalidTokenIndex.into());
    }
    let token_idx = usize::from(token_idx);
    let &token_addr = &accs.init_sale_vaa.get_accepted_token_address(token_idx, &accs.init_sale_vaa.meta().payload[..]);
    let token_chain = accs.init_sale_vaa.get_accepted_token_chain(token_idx, &accs.init_sale_vaa.meta().payload[..]);
    if &token_addr != accs.mint.info().key || token_chain != CHAIN_ID_SOLANA {
        return Err(InvalidTokenAddress.into());
    }

    // Create and init custody account as needed.
    // https://github.com/certusone/wormhole/blob/1792141307c3979b1f267af3e20cfc2f011d7051/solana/modules/token_bridge/program/src/api/transfer.rs#L159
    // if !accs.custody.is_initialized() {
    //     accs.custody.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;       // Cuurent vallet is payer

    //     let init_ix = spl_token::instruction::initialize_account(
    //         &spl_token::id(),
    //         accs.custody.info().key,
    //         accs.mint.info().key,
    //         accs.custody_signer.key,
    //     )?;
    //     invoke_signed(&init_ix, ctx.accounts, &[])?;
    // }

    // Create/Load contribution PDA account. 
    if !accs.contribution_state.is_initialized() {
        accs.contribution_state.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;
    }

    // TBD Transfer tokens  from->custody non-WH transfer.
    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::id(),
        accs.from.info().key,
        accs.custody.info().key,
        accs.authority_signer.key,
        &[],
        data.amount,
    )?;
    invoke_seeded(&transfer_ix, ctx, &accs.authority_signer, None)?;

    // store new amount.
    accs.contribution_state.amount = accs.contribution_state.amount + data.amount;
    Ok(())
}
