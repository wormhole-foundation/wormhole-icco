use anchor_lang::prelude::*;
use anchor_spl::associated_token;

mod constants;
mod context;
mod error;
mod state;
mod wormhole;

use constants::*;
use context::*;
use error::*;
use state::*;
use wormhole::get_message_data;

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

    pub fn init_sale(ctx: Context<InitializeSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.parse_sale_init(&msg.payload, &ctx.accounts.contributor.key())?;

        // NOTE: do we create atas here?
        // not sure how CpiContext works
        /*
        for token in &sale.accepted_tokens {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.owner.to_account_info(),
                creation_accounts,
                &[&to_seeds],
            );
            associated_token::create()
        }
        */
        Ok(())
    }

    pub fn create_buyer_account(ctx: Context<CreateBuyerAccount>) -> Result<()> {
        ctx.accounts
            .buyer
            .new(ctx.accounts.sale.get_num_accepted_tokens())
    }

    pub fn contribute(
        ctx: Context<Contribute>,
        sale_id: Vec<u8>,
        token_index: u8,
        amount: u64,
    ) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;
        let idx = sale.get_accepted_token_index(token_index)?;
        let contributed = ctx.accounts.buyer.contribute(idx, amount)?;

        // now update total contributions
        sale.update_total_contributions(idx, contributed)
    }

    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.parse_sale_sealed(&msg.payload)
    }

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.parse_sale_aborted(&msg.payload)
    }
}

#[derive(Accounts)]
pub struct Initialize {}
