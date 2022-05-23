use anchor_lang::prelude::*;

use crate::state::{config::ContributorConfig, sale::Sale};

pub fn init_sale(ctx: Context<IccoVaa>) -> Result<()> {
    ctx.accounts.sale.initialize(
        ctx.accounts.config.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )
}

pub fn sale_sealed(ctx: Context<IccoVaa>) -> Result<()> {
    ctx.accounts.sale.seal(
        ctx.accounts.config.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )
}

pub fn sale_aborted(ctx: Context<IccoVaa>) -> Result<()> {
    ctx.accounts.sale.abort(
        ctx.accounts.config.as_ref(),
        ctx.accounts.claimable_vaa.data.borrow().as_ref(),
    )
}

#[derive(Accounts)]
pub struct IccoVaa<'info> {
    // TODO: why add 8?
    #[account(init, payer = owner, space = Sale::MAXIMUM_SIZE + 8)]
    pub sale: Account<'info, Sale>,

    #[account(init, payer = owner, space = ContributorConfig::MAXIMUM_SIZE + 8)]
    pub config: Account<'info, ContributorConfig>,

    /// CHECK: ...
    pub claimable_vaa: AccountInfo<'info>,

    // seeds: emitter_addr, emitter_chain, seq
    // pid: core bridge
    /// CHECK: ...
    #[account(mut)]
    pub claim_pda: AccountInfo<'info>,

    /// CHECK: ...
    #[account(executable)]
    pub core_bridge: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}
