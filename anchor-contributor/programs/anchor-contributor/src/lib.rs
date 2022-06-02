use anchor_lang::prelude::*;
use anchor_lang::solana_program::borsh::try_from_slice_unchecked;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction::transfer;

mod constants;
mod context;
mod env;
mod error;
mod state;
mod wormhole;

use constants::*;
use context::*;
use error::*;
use state::sale::{get_conductor_address, get_conductor_chain, verify_conductor_vaa};
use wormhole::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod anchor_contributor {
    use super::*;

    use anchor_spl::{*, token::TokenAccount};

    pub fn create_custodian(ctx: Context<CreateCustodian>) -> Result<()> {
        let custodian = &mut ctx.accounts.custodian;
        custodian.owner = ctx.accounts.owner.key();

        Ok(())
    }

    pub fn init_sale(ctx: Context<InitializeSale>) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_INIT_SOLANA)?;
        let sale = &mut ctx.accounts.sale;

        // set token custodian to check for future sale updates
        sale.set_custodian(&ctx.accounts.custodian.key());

        // now parse vaa
        sale.parse_sale_init(&msg.payload)?;

        // TODO: use associated sale token account to get decimals
        // for now, hardcoding to 9
        let sale_token_decimals = 9u8;
        sale.set_native_sale_token_decimals(sale_token_decimals)?;

        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        // find token_index
        let mint = token::accessor::mint(&ctx.accounts.buyer_ata.to_account_info())?;
        let token_index = sale.get_token_index(&mint)?;

        msg!(
            "mint: {:?}, token_index: {:?}, custodian_ata: {:?}, buyer_ata: {:?}",
            mint,
            token_index,
            &ctx.accounts.custodian_ata.key(),
            &ctx.accounts.buyer_ata.key()
        );

        let owner = &ctx.accounts.owner;

        //let ata_seeds: &'a [&[u8]] = &[&owner.key().as_ref(), &token::ID.as_ref(), &mint.as_ref()];
        let (ata, bump) = Pubkey::find_program_address(
            &[&owner.key().as_ref(), &token::ID.as_ref(), &mint.as_ref()],
            &associated_token::AssociatedToken::id(),
        );
        msg!("ata: {:?}, bump: {:?}", ata, bump);

        // spl transfer contribution
        /*
        let ix = spl_token::instruction::transfer(
            &token::ID,
            &ctx.accounts.buyer_ata.key(),
            &ctx.accounts.custodian_ata.key(),
            &ctx.accounts.owner.key(),
            &[&ctx.accounts.owner.key()],
            amount,
        )?;

        invoke(
            &ix,
            &[
                ctx.accounts.buyer_ata.to_account_info(),
                ctx.accounts.custodian_ata.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
        )?;
        */

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    to: ctx.accounts.custodian_ata.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
                &[&[ctx.accounts.owner.key().as_ref()]],
            ),
            amount,
        )?;

        /*
        let custodian_bump = ctx.bumps["custodian"];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    from: ctx.accounts.custodian_ata.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[custodian_bump]]],
            ),
            amount,
        )?;
        */

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

        msg!("finished");
        Ok(())
    }

    pub fn attest_contributions(ctx: Context<AttestContributions>) -> Result<()> {
        // get accepted token index
        let sale = &mut ctx.accounts.sale;

        let clock = Clock::get()?;
        let vaa_payload = sale.serialize_contributions(clock.unix_timestamp)?;

        // Send WH Message
        let bridge_data: BridgeData =
            try_from_slice_unchecked(&ctx.accounts.wormhole_config.data.borrow_mut())?;
        //Send Fee
        invoke_signed(
            &transfer(
                &ctx.accounts.payer.key(),
                &ctx.accounts.wormhole_fee_collector.key(),
                bridge_data.config.fee,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.wormhole_fee_collector.to_account_info(),
            ],
            &[],
        )?;

        //Send Post Msg Tx
        let sendmsg_ix = Instruction {
            program_id: ctx.accounts.core_bridge.key(),
            accounts: vec![
                AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                AccountMeta::new(ctx.accounts.wormhole_message_key.key(), true),
                AccountMeta::new_readonly(ctx.accounts.wormhole_derived_emitter.key(), true),
                AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.wormhole_fee_collector.key(), false),
                AccountMeta::new_readonly(ctx.accounts.clock.key(), false),
                AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            ],
            data: (
                wormhole::Instruction::PostMessage,
                PostMessageData {
                    nonce: 0, //should only be emitted once, so no need for nonce
                    payload: vaa_payload,
                    consistency_level: wormhole::ConsistencyLevel::Confirmed,
                },
            )
                .try_to_vec()?,
        };

        invoke_signed(
            &sendmsg_ix,
            &[
                ctx.accounts.wormhole_config.to_account_info(),
                ctx.accounts.wormhole_message_key.to_account_info(),
                ctx.accounts.wormhole_derived_emitter.to_account_info(),
                ctx.accounts.wormhole_sequence.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.wormhole_fee_collector.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[
                &b"emitter".as_ref(),
                &[*ctx.bumps.get("wormhole_derived_emitter").unwrap()],
            ]], 
        )?;

        Ok(())
    }

    /**
     *
     */
    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_SEALED)?;

        let sale = &mut ctx.accounts.sale;
        sale.parse_sale_sealed(&msg.payload)?;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants
        let sale_token_account = sale.associated_sale_token_address;

        // TODO: need to bridge collateral over to recipient (total_collateral minus excess_collateral)
        // TODO: set up cfg flag to just use constants instead of these getters
        let conductor_chain = get_conductor_chain()?;
        let conductor_address = get_conductor_address()?;

        for (i, total) in sale.totals.iter().enumerate() {
            let mint = total.mint;
            let amount = total.contributions;
            let recipient = sale.recipient;
            // token bridge transfer this amount over to conductor_address on conductor_chain to recipient
            let custody_ata = ctx.remaining_accounts[2*i];
            let token_acc = ctx.remaining_accounts[(2*i)+1];
        }
        Ok(())
    }

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        //let msg = get_message_data(&ctx.accounts.core_bridge_vaa)?;
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_ABORTED)?;
        ctx.accounts.sale.parse_sale_aborted(&msg.payload)?;

        Ok(())
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        require!(sale.is_aborted(), SaleError::SaleNotAborted);

        let refunds = ctx.accounts.buyer.claim_refunds(&sale.totals)?;
        let atas = &ctx.remaining_accounts;
        require!(
            atas.len() == sale.totals.len(),
            SaleError::InvalidRemainingAccounts
        );

        let owner = &ctx.accounts.owner.key();
        let custodian = &ctx.accounts.custodian.key();

        // iterate over refunds and reference remaining accounts by index
        for (i, refund) in refunds.iter().enumerate() {
            let buyer_index = 2 * i;

            let buyer_ata = atas[buyer_index].to_account_info();
            {
                let mint = token::accessor::mint(&buyer_ata)?;
                require!(
                    sale.get_token_index(&mint).is_ok(),
                    SaleError::InvalidRemainingAccounts
                );
                let authority = token::accessor::authority(&buyer_ata)?;
                require!(authority == *owner, SaleError::InvalidRemainingAccounts);
            }

            let custodian_index = buyer_index + 1;
            let custodian_ata = atas[custodian_index].to_account_info();
            {
                let mint = token::accessor::mint(&custodian_ata)?;
                require!(
                    sale.get_token_index(&mint).is_ok(),
                    SaleError::InvalidRemainingAccounts
                );
                let authority = token::accessor::authority(&custodian_ata)?;
                require!(authority == *custodian, SaleError::InvalidRemainingAccounts);
            }

            // TODO: transfer back to owner
        }
        Ok(())
    }
}
