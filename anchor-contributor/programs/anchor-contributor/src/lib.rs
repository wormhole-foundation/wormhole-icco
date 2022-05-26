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
    use anchor_spl::token;

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


    pub fn init_accepted_token_page(_ctx: Context<InitAcceptedTokenPage>, _pg_num:u8) -> Result<()> {
        Ok(())
    }


    pub fn init_sale(ctx: Context<InitializeSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.parse_sale_init(&msg.payload)?;

        require!(sale.num_accepted != 0, SaleError::InvalidAcceptedTokens);


        //We are going to fetch all the accepted tokens and store them in pages
        // Each page is 10 KB. Each page maintains two arrays, AcceptedToken[] (size 33) and AssetTotal[] (size 24)
        // This means each page can store up to 175 entries each. Leaving a small buffer for metadata,
        // Lets cap it at 170 entries per page.

        let accepted_token_pages_amt = (sale.num_accepted / ACCEPTED_TOKENS_PER_PAGE) + 1; //feel free to replace with fancier scale math
        for page_num in 1..accepted_token_pages_amt {
            let mut page: AcceptedTokenPage = AcceptedTokenPage::try_from_slice(&ctx.remaining_accounts[page_num as usize].data.borrow_mut())?;
            
            for idx in 0..ACCEPTED_TOKENS_PER_PAGE {
                let token_index = (idx * page_num) as usize;
                let start = INDEX_ACCEPTED_TOKENS_START + 1 + (token_index * ACCEPTED_TOKENS_N_BYTES);
                if let Some(token) = AcceptedToken::make_from_slice(
                    idx,
                    &msg.payload[start..start + ACCEPTED_TOKENS_N_BYTES],
                ) {
                    page.add_token(token, AssetTotal { contributions: 0, allocations: 0, excess_contributions: 0 });
                }
            }
            
        }   
        Ok(())
    }


    /*
    pub fn contribute(
        ctx: Context<Contribute>,
        sale_id: Vec<u8>,
        token_index: u8,
        amount: u64,
    ) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        // leverage token index search from sale's accepted tokens to find index
        // on buyer's contributions
        sale.load_mut().unwrap().update_total_contributions(token_index as usize, amount)?;

        // now update buyer's contributions
        ctx.accounts.buyer.contribute(token_index as usize, amount)?;

        Ok(())
    }

    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.load_mut().unwrap().parse_sale_sealed(&msg.payload)
    }

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;

        let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        sale.load_mut().unwrap().parse_sale_aborted(&msg.payload)
    }
    */
}
