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

    pub fn create_config(
        ctx: Context<CreateContributorConfig>,
        conductor_chain: u16,
        conductor_address: Vec<u8>,
        wormhole: Pubkey,
        token_bridge: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(conductor_chain != 1u16, ConfigError::InvalidConductor);

        config.conductor_chain = conductor_chain;
        config.conductor_address = conductor_address.try_into().expect("incorrect byte length");
        config.wormhole = wormhole;
        config.token_bridge = token_bridge;
        config.bump = *ctx.bumps.get("contributor-config").unwrap();

        Ok(())
    }

    pub fn init_sale(ctx: Context<IccoVaa>) -> Result<()> {
        instructions::init_sale(ctx)
    }

    pub fn sale_sealed(ctx: Context<IccoVaa>) -> Result<()> {
        instructions::sale_sealed(ctx)
    }

    pub fn sale_aborted(ctx: Context<IccoVaa>) -> Result<()> {
        instructions::sale_aborted(ctx)
    }
}
