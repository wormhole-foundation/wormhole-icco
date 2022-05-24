use anchor_lang::prelude::*;

mod context;
mod state;
mod wormhole;
mod error;
mod constants;

use constants::*;
use context::*;
use state::*;
use error::*;


declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod anchor_contributor {
    use super::*;

    pub fn create_contributor(
        ctx: Context<CreateContributor>,
        conductor_chain: u16,
        conductor_address: Vec<u8>,
    ) -> Result<()> {
        let contributor = &mut ctx.accounts.contributor;

        // there isn't a solana conductor (yet? bwahaha)
        require!(conductor_chain != 1u16, ContributorError::InvalidConductor);

        contributor.conductor_chain = conductor_chain;
        contributor.conductor_address =
            conductor_address.try_into().expect("incorrect byte length");
        contributor.owner = ctx.accounts.owner.key();

        Ok(())
    }

    pub fn init_sale(ctx:Context<InitSale>) -> Result<()> {
        Ok(())
    }    
}

#[derive(Accounts)]
pub struct Initialize {}