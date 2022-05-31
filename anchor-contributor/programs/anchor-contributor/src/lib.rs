use anchor_lang::prelude::*;

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
        let sale = &mut ctx.accounts.sale;
        sale.parse_sale_init(&msg.payload)?;

        // TODO: use associated sale token account to get decimals
        // for now, hardcoding to 9
        let sale_token_decimals = 9u8;
        sale.set_native_sale_token_decimals(sale_token_decimals);

        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, token_index: u8, amount: u64) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        // TODO: need to do spl transfer from buyer's wallet to accepted token's ATA
        let accepted_account_address =
            sale.get_associated_accepted_address(&ctx.program_id, token_index)?;

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

    pub fn attest_contributions(ctx: Context<AttestContributions>) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        let clock = Clock::get()?;
        let vaa_payload = sale.serialize_contributions(clock.unix_timestamp)?;

        // TODO: send wormhole message

        Ok(())
    }

    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_SEALED)?;

        let sale = &mut ctx.accounts.sale;
        sale.parse_sale_sealed(&msg.payload)?;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants
        let sale_token_account = sale.associated_sale_token_address;

        // TODO: need to bridge collateral over to recipient (total_collateral minus excess_collateral)

        Ok(())
    }

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
