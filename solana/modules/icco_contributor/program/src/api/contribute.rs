#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use std::mem::size_of_val;
use crate::{
    messages::*,
    accounts::{
        ConfigAccount,
        SaleStateAccount,
//        SaleStateAccountDerivationData,
        CustodySigner,
        CustodyAccount,
        CustodyAccountDerivationData,
        ContributionStateAccount,
        ContributionStateAccountDerivationData,
        AuthoritySigner,
    },
    errors::Error::*,
    types::*,
    claimed_vaa::ClaimedVAA,
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
//        DeserializePayload,
//        PayloadMessage,
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
    pub config: ConfigAccount<'b, { AccountState::Initialized }>,
    pub init_sale_vaa: ClaimedVAA<'b, InitSale>,           // Was claimed.

    pub contribution_state: Mut<ContributionStateAccount<'b, { AccountState::MaybeInitialized }>>, 

    pub from: Mut<Data<'b, SplAccount, { AccountState::Initialized }>>,     // From account
//    pub mint: Mut<Data<'b, SplMint, { AccountState::Initialized }>>,        // From token Why Mut??

    pub mint: Data<'b, SplMint, { AccountState::Initialized }>,        // From token Why Mut??
    pub custody: Mut<CustodyAccount<'b, { AccountState::Initialized }>>, 

    pub clock: Sysvar<'b, Clock>,
    // Sale state is in ctx.accounts[11]; // after more sys accounts. See instructions.rs
}

/*
impl<'a> From<&ContributeIccoSale<'a>> for SaleStateAccountDerivationData {
    fn from(accs: &ContributeIccoSale<'a>) -> Self {
        SaleStateAccountDerivationData {
            sale_id: accs.init_sale_vaa.sale_id,
        }
    }
}
*/

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
            contributor: *accs.payer.info().key,    // Needs to be wallet to be able to potentially use multiple contrib subaccounts?
            token: *accs.mint.info().key,
        }
    }
}


#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct ContributeIccoSaleData {
    pub amount: u64,
    pub token_idx: u8,
}


pub fn contribute_icco_sale(
    ctx: &ExecutionContext,
    accs: &mut ContributeIccoSale,
    data: ContributeIccoSaleData,
) -> Result<()> {
    msg!("In contribute_icco_sale!");

    let sale_state_account_info = &ctx.accounts[11];
    //msg!("state_key: {:?}", sale_state_account_info.key);
    let mut state_data = sale_state_account_info.data.borrow_mut();

    // Check sale status.
    if get_sale_state_sealed(&state_data) || get_sale_state_aborted(&state_data) {
        return Err(SaleSealedOrAborted.into());
    }
/*
    // TBD This does not work yet. EVM Time is not Linux.
    // Check if sale started.

    let now_time = accs.clock.unix_timestamp as u128;       // i64 ->u128
    if now_time < accs.init_sale_vaa.get_sale_start(&accs.init_sale_vaa.meta().payload[..]).0 {
        return Err(SaleHasNotStarted.into());
    }
    if now_time > accs.init_sale_vaa.get_sale_end(&accs.init_sale_vaa.meta().payload[..]).0 {
        return Err(SaleHasEnded.into());
    }
*/

    // Make sure token Idx matches passed in token mint addr.
/*
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
*/

// Create/Load contribution PDA account. 
    if !accs.contribution_state.is_initialized() {
        accs.contribution_state.create(&(&*accs).into(), ctx, accs.payer.key, Exempt)?;
    }

    // Transfer tokens from->custody. Non-WH transfer.
    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::id(),
        accs.from.info().key,
        accs.custody.info().key,
        accs.payer.key,   // accs.authority_signer.key,      // Payer?
        &[],
        data.amount,
    )?;
    invoke_signed(&transfer_ix, ctx.accounts, &[])?;

//    invoke_seeded(&transfer_ix, ctx, &accs.payer, None)?;
//    invoke_seeded(&transfer_ix, ctx, &accs.authority_signer, None)?;

    // store new amount in Custody and State accounts.
    let token_idx = data.token_idx;
    let tmp_v = get_sale_state_contribution(&state_data, token_idx) + data.amount;
    set_sale_state_contribution(& mut state_data, token_idx, tmp_v);
//    accs.sale_state.contributions[token_idx] = accs.sale_state.contributions[token_idx] + data.amount;
    accs.contribution_state.amount = accs.contribution_state.amount + data.amount;
    Ok(())
}
