use anchor_lang::prelude::*;
use std::str;

use crate::state::{
    config::Contributor,
    sale::{Sale, SaleMessage},
};

use crate::{
    config::ContributorError,
    sale::{PAYLOAD_SALE_ABORTED, PAYLOAD_SALE_INIT, PAYLOAD_SALE_SEALED},
    wormhole::parse_vaa,
};

const SEED_PREFIX_SALE: &str = "icco-sale";

pub fn init_sale(ctx: Context<CreateWithVaa>) -> Result<()> {
    let contributor = ctx.accounts.contributor.as_ref();
    let parsed = parse_vaa(ctx.accounts.claimable_vaa.data.borrow().as_ref())?;

    let message = &mut ctx.accounts.message;
    let payload = message.deserialize_header(contributor, parsed, PAYLOAD_SALE_INIT)?;

    let sale = &mut ctx.accounts.sale;

    // initialize sale
    sale.initialize(contributor, message.id.clone(), &payload)?;

    // create bump for pda
    // TODO: is this right? I want to create a seed based
    // on the contributor's key and sale id
    sale.bump = *ctx.bumps.get(SEED_PREFIX_SALE.into()).unwrap();
    Ok(())
}

pub fn sale_sealed(ctx: Context<ModifyWithVaa>) -> Result<()> {
    let contributor = ctx.accounts.contributor.as_ref();
    let parsed = parse_vaa(ctx.accounts.claimable_vaa.data.borrow().as_ref())?;

    let message = &mut ctx.accounts.message;
    let payload = message.deserialize_header(contributor, parsed, PAYLOAD_SALE_SEALED)?;

    ctx.accounts
        .sale
        .seal(contributor, message.id.clone(), &payload)
}

pub fn sale_aborted(ctx: Context<ModifyWithVaa>) -> Result<()> {
    let contributor = ctx.accounts.contributor.as_ref();
    let parsed = parse_vaa(ctx.accounts.claimable_vaa.data.borrow().as_ref())?;

    let message = &mut ctx.accounts.message;
    let payload = message.deserialize_header(contributor, parsed, PAYLOAD_SALE_ABORTED)?;

    ctx.accounts
        .sale
        .abort(contributor, message.id.clone(), &payload)
}

#[derive(Accounts)]
pub struct CreateWithVaa<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        init,
        payer = owner,
        space = 8 + SaleMessage::MAXIMUM_SIZE,
    )]
    pub message: Account<'info, SaleMessage>,

    #[account(
        init,
        payer = owner,
        space = 8 + Sale::MAXIMUM_SIZE,
        seeds = [SEED_PREFIX_SALE.as_bytes(), contributor.key().as_ref(), &message.id],
        bump,
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

#[derive(Accounts)]
pub struct ModifyWithVaa<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        init,
        payer = owner,
        space = 8 + SaleMessage::MAXIMUM_SIZE,
    )]
    pub message: Account<'info, SaleMessage>,

    #[account(
        mut,
        seeds = [SEED_PREFIX_SALE.as_bytes(), contributor.key().as_ref(), &sale.id],
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
