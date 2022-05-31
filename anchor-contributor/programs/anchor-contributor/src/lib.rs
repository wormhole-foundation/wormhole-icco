use anchor_lang::prelude::*;
use anchor_spl::associated_token;

mod constants;
mod context;
mod env;
mod error;
mod state;
mod wormhole;

use constants::*;
use context::*;
use error::*;
use state::sale::verify_conductor_vaa;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod anchor_contributor {
    use anchor_spl::token;

    use super::*;

    pub fn init_sale(ctx: Context<InitializeSale>) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_INIT_SOLANA)?;
        ctx.accounts.sale.parse_sale_init(&msg.payload)?;

        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, token_index: u8, amount: u64) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        // TODO: need to do spl transfer from buyer's wallet to accepted token's ATA
        let ata = sale.get_accepted_ata(&ctx.program_id, token_index)?;

        // leverage token index search from sale's accepted tokens to find index
        // on buyer's contributions
        let clock = Clock::get()?;
        let idx = sale.update_total_contributions(clock.unix_timestamp, token_index, amount)?;

        // now update buyer's contributions
        let buyer = &mut ctx.accounts.buyer;
        if !buyer.initialized {
            buyer.initialize();
        }
        buyer.contribute(idx, amount)?;

        Ok(())
    }
    /*

    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.load_mut().unwrap().parse_sale_sealed(&msg.payload)
    }
    */

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        //let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_ABORTED)?;
        ctx.accounts.sale.parse_sale_aborted(&msg.payload)?;

        Ok(())
    }

    pub fn claim_refunds(ctx: Context<ClaimRefund>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        require!(sale.is_aborted(), SaleError::SaleNotAborted);

        let refunds = ctx.accounts.buyer.claim_refunds(&sale.totals)?;
        for _refund in &refunds {
            // TODO: transfer back to owner
        }
        Ok(())
    }
}
