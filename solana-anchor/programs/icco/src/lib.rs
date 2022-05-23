use anchor_lang::prelude::*;

mod context;
use context::*;
mod error;
use error::*;
mod constants;
use constants::*;
mod state;
use state::*;
mod wormhole;
use wormhole::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod icco {
    use super::*;

    pub fn contract_controlled_transfer(ctx:Context<CCT>) -> Result<()> {
        Ok(())
    }
}
