use anchor_lang::prelude::*;

use instructions::*;
use state::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub mod instructions;
pub mod state;
pub mod wormhole;

#[program]
pub mod icco_contributor {
    use super::*;

    pub fn create_contributor(
        ctx: Context<CreateContributor>,
        conductor_chain: u16,
        conductor_address: Vec<u8>,
        wormhole: Pubkey,
        token_bridge: Pubkey,
    ) -> Result<()> {
        let contributor = &mut ctx.accounts.contributor;

        // there isn't a solana conductor (yet? bwahaha)
        require!(conductor_chain != 1u16, ContributorError::InvalidConductor);

        contributor.conductor_chain = conductor_chain;
        contributor.conductor_address =
            conductor_address.try_into().expect("incorrect byte length");
        contributor.wormhole = wormhole;
        contributor.token_bridge = token_bridge;

        Ok(())
    }

    pub fn init_sale(ctx: Context<CreateWithVaa>) -> Result<()> {
        instructions::init_sale(ctx)
    }

    pub fn sale_sealed(ctx: Context<ModifyWithVaa>) -> Result<()> {
        instructions::sale_sealed(ctx)
    }

    pub fn sale_aborted(ctx: Context<ModifyWithVaa>) -> Result<()> {
        instructions::sale_aborted(ctx)
    }
}
