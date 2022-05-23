use anchor_lang::prelude::*;
use std::str;

use crate::state::{config::Contributor, sale::Sale};

use crate::config::ContributorError;

const SEED_PREFIX_SALE: &str = "icco-sale";

pub fn init_sale(ctx: Context<IccoVaa>) -> Result<()> {
    let sale = &mut ctx.accounts.sale;

    // initialize sale
    sale.initialize(
        ctx.accounts.contributor.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )?;

    // create bump for pda
    // TODO: is this right? I want to create a seed based
    // on the contributor's key and sale id
    let mut concatenated: Vec<u8> = SEED_PREFIX_SALE.into();
    concatenated.extend(sale.id);

    let result = str::from_utf8(concatenated.as_slice());
    require!(result.is_ok(), ContributorError::InvalidConductor);

    sale.bump = *ctx.bumps.get(result.unwrap()).unwrap();
    Ok(())
}

pub fn sale_sealed(ctx: Context<IccoVaa>) -> Result<()> {
    ctx.accounts.sale.seal(
        ctx.accounts.contributor.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )
}

pub fn sale_aborted(ctx: Context<IccoVaa>) -> Result<()> {
    ctx.accounts.sale.abort(
        ctx.accounts.contributor.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )
}

#[derive(Accounts)]
pub struct IccoVaa<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Contributor::MAXIMUM_SIZE,
    )]
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [SEED_PREFIX_SALE.as_bytes(), &sale.id, contributor.key().as_ref()],
        bump = sale.bump
    )]
    pub sale: Account<'info, Sale>,

    /// CHECK: pda of vaa bytes
    pub claimable_vaa: AccountInfo<'info>,

    // seeds: emitter_addr, emitter_chain, seq
    // pid: core bridge
    /// CHECK: pda to check whether vaa was claimed already
    #[account(mut)]
    pub claim_pda: AccountInfo<'info>,

    /// CHECK: wormhole program
    #[account(executable)]
    pub core_bridge: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}
