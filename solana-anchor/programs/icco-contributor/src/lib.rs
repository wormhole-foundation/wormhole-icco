use anchor_lang::prelude::*;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub mod instructions;
pub mod state;

#[program]
pub mod icco_contributor {
    use super::*;

    pub fn init_sale(
        ctx: Context<SaleInit>,
        message_key: Pubkey,
        signed_vaa: Vec<u8>,
    ) -> Result<()> {
        instructions::init_sale(ctx, message_key, signed_vaa)
    }
}
