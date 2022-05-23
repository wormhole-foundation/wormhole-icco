use anchor_lang::prelude::*;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub mod instructions;
pub mod state;
pub mod wormhole;

#[program]
pub mod icco_contributor {
    use super::*;

    pub fn init_sale(ctx: Context<SaleInit>) -> Result<()> {
        instructions::init_sale(ctx)
    }
}
