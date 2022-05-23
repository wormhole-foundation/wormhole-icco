use anchor_lang::prelude::*;

use crate::state::sale::Sale;

pub fn init_sale(ctx: Context<SaleInit>) -> Result<()> {
    ctx.accounts
        .sale
        .initialize(ctx.accounts.claimable_vaa.data.borrow().as_ref())
}

#[derive(Accounts)]
pub struct SaleInit<'info> {
    // TODO: why add 8?
    #[account(init, payer = owner, space = Sale::MAXIMUM_SIZE + 8)]
    pub sale: Account<'info, Sale>,

    /// CHECK: ...
    pub claimable_vaa: AccountInfo<'info>,

    // seeds: emitter_addr, emitter_chain, seq
    // pid: core bridge
    /// CHECK: ...
    #[account(mut)]
    pub claim_pda: AccountInfo<'info>,

    /// CHECK: ...
    #[account(executable)]
    pub token_bridge: AccountInfo<'info>,

    /// CHECK: ...
    #[account(executable)]
    pub core_bridge: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}
