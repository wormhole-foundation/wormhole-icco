use anchor_lang::prelude::*;

use crate::state::sale::Sale;

pub fn init_sale(ctx: Context<SaleInit>, message_key: Pubkey, signed_vaa: Vec<u8>) -> Result<()> {
    ctx.accounts.sale.start(message_key, signed_vaa)
}

#[derive(Accounts)]
pub struct SaleInit<'info> {
    // TODO: why add 8?
    #[account(init, payer = owner, space = Sale::MAXIMUM_SIZE + 8)]
    pub sale: Account<'info, Sale>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}
