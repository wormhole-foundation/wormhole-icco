use anchor_lang::prelude::*;
use anchor_lang::solana_program::borsh::try_from_slice_unchecked;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::{invoke,invoke_signed};
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_lang::solana_program::sysvar::*;
use spl_token::*;
use anchor_spl::*;

mod constants;
mod context;
mod env;
mod error;
mod state;
mod wormhole;
mod token_bridge;

use constants::*;
use context::*;
use error::*;
use state::sale::{AssetTotal,get_conductor_address, get_conductor_chain, verify_conductor_vaa};
use wormhole::*;
use token_bridge::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod anchor_contributor {
    use super::*;

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

        // Use associated sale token account to get solana native decimals
        let sale_token_decimals = ctx.accounts.sale_token_mint.decimals;
        sale.set_native_sale_token_decimals(sale_token_decimals)?;

        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        let from_account = &ctx.accounts.buyer_ata;

        // find token_index
        let mint = token::accessor::mint(&from_account.to_account_info())?;

        let sale = &mut ctx.accounts.sale;
        let token_index = sale.get_token_index(&mint)?;

        // leverage token index search from sale's accepted tokens to find index
        // on buyer's contributions
        let clock = Clock::get()?;
        let idx = sale.update_total_contributions(clock.unix_timestamp, token_index, amount)?;

        // now update buyer's contributions
        let buyer = &mut ctx.accounts.buyer;
        if !buyer.initialized {
            buyer.initialize(sale.totals.len());
        }
        buyer.contribute(idx, amount)?;

        let to_account = &ctx.accounts.custodian_ata;
        let transfer_authority = &ctx.accounts.owner;

        // spl transfer contribution
        /*
        // this doesn't work in devnet?

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
        */

        invoke(
            &spl_token::instruction::transfer(
                &token::ID,
                &ctx.accounts.buyer_ata.key(),
                &ctx.accounts.custodian_ata.key(),
                &transfer_authority.key(),
                &[&transfer_authority.key()],
                amount,
            )?,
            &ctx.accounts.to_account_infos(),
        )?;
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

    /*
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

        let (token_bridge_mint_key, _) = Pubkey::find_program_address(&["mint_signer".as_ref()], &ctx.accounts.token_bridge.key());

        for (i, total) in sale.totals.iter().enumerate() {
            let mint = total.mint;
            let amount = total.contributions;
            let recipient = sale.recipient;
            // token bridge transfer this amount over to conductor_address on conductor_chain to recipient
            let custody_ata = ctx.remaining_accounts[4*i];
            let mut token_account_data:&[u8] = &ctx.remaining_accounts[(4*i)+1].data.borrow_mut();
            let token_acc:token::TokenAccount = token::TokenAccount::try_deserialize(&mut token_account_data)?;
            let wrapped_mint_key = ctx.remaining_accounts[(4*i)+3];
            let wrapped_meta_key: 

            let mut is_native = true;
            if token_acc.mint == token_bridge_mint_key {
                // Wrapped Portal Token
                let send_wrapped_ix = Instruction {
                    program_id: ctx.accounts.token_bridge.key(),
                    accounts: vec![
                        AccountMeta::new(ctx.accounts.owner.key(), true),
                        AccountMeta::new_readonly(ctx.accounts.token_config.key(), false),
                        AccountMeta::new(custody_ata.key(), false),
                        AccountMeta::new_readonly(ctx.accounts.custodian.key(), true),
                        AccountMeta::new(token_acc.mint, false),
                        AccountMeta::new_readonly(wrapped_meta_key, false),
                        AccountMeta::new_readonly(authority_signer, false),
                        AccountMeta::new(bridge_config, false),
                        AccountMeta::new(message_key, true),
                        AccountMeta::new_readonly(emitter_key, false),
                        AccountMeta::new(sequence_key, false),
                        AccountMeta::new(fee_collector_key, false),
                        AccountMeta::new_readonly(solana_program::sysvar::clock::id(), false),
                        // Dependencies
                        AccountMeta::new_readonly(solana_program::sysvar::rent::id(), false),
                        AccountMeta::new_readonly(solana_program::system_program::id(), false),
                        // Program
                        AccountMeta::new_readonly(bridge_id, false),
                        AccountMeta::new_readonly(spl_token::id(), false),
                    ],
                    data: (
                        TRANSFER_WRAPPED_INSTRUCTION, 
                        TransferData {
                            nonce: ctx.accounts.custodian.nonce,
                            amount: amount,
                            fee: 0_u64,
                            target_address: Pubkey::new(&recipient),
                            target_chain: sale.token_chain,
                        }    
                    ).try_to_vec()?
                };
            } else {
                //Native Token
            }

            ctx.accounts.custodian.nonce += 1;
        }
        Ok(())
    }
    */

    pub fn send_contributions(ctx:Context<SendContributions>, token_idx:u8) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_SEALED)?;

        let sale = &mut ctx.accounts.sale;
        sale.parse_sale_sealed(&msg.payload)?;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants
        let sale_token_account = sale.associated_sale_token_address;

        let conductor_chain = get_conductor_chain()?;
        let conductor_address = get_conductor_address()?;

        let asset:AssetTotal = *sale.totals.get(token_idx as usize).unwrap();
        let mint = asset.mint;
        let amount = asset.contributions;
        let recipient = sale.recipient;
        // token bridge transfer this amount over to conductor_address on conductor_chain to recipient
        let custody_ata = ctx.accounts.custody_ata;
        let mut token_account_data:&[u8] = &ctx.accounts.mint_token_account.data.borrow();
        let token_acc:token::TokenAccount = token::TokenAccount::try_deserialize(&mut token_account_data)?;
        let wrapped_meta_key = ctx.accounts.wrapped_meta_key;

        if token_acc.mint == ctx.accounts.token_mint_signer.key() {
            //Wrapped Token
            let send_wrapped_ix = Instruction {
                program_id: ctx.accounts.token_bridge.key(),
                accounts: vec![
                    AccountMeta::new(ctx.accounts.owner.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.token_config.key(), false),
                    AccountMeta::new(custody_ata.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.custodian.key(), true),
                    AccountMeta::new(token_acc.mint, false),
                    AccountMeta::new_readonly(wrapped_meta_key.key(), false), // Wrapped Meta Key
                    AccountMeta::new_readonly(ctx.accounts.token_bridge_authority_signer.key(), false),
                    AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                    AccountMeta::new(ctx.accounts.wormhole_message_key.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.wormhole_derived_emitter.key(), false),
                    AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                    AccountMeta::new(ctx.accounts.wormhole_fee_collector.key(), false),
                    AccountMeta::new_readonly(clock::id(), false),
                    // Dependencies
                    AccountMeta::new_readonly(rent::id(), false),
                    AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                    // Program
                    AccountMeta::new_readonly(ctx.accounts.core_bridge.key(), false),
                    AccountMeta::new_readonly(spl_token::id(), false),
                ],
                data: (
                    TRANSFER_WRAPPED_INSTRUCTION, 
                    TransferData {
                        nonce: ctx.accounts.custodian.nonce,
                        amount: amount,
                        fee: 0_u64,
                        target_address: Pubkey::new(&recipient),
                        target_chain: sale.token_chain,
                    }    
                ).try_to_vec()?
            };

            invoke_signed(
                &send_wrapped_ix,
                &[
                    ctx.accounts.owner.to_account_info(),
                    ctx.accounts.token_config.to_account_info(),
                    custody_ata.to_account_info(),
                    ctx.accounts.custodian.to_account_info(),
                    ctx.accounts.mint_token_account.to_account_info(),
                    wrapped_meta_key.to_account_info(),
                    ctx.accounts.token_bridge_authority_signer.to_account_info(),
                    ctx.accounts.wormhole_config.to_account_info(),
                    ctx.accounts.wormhole_message_key.to_account_info(),
                    ctx.accounts.wormhole_derived_emitter.to_account_info(),
                    ctx.accounts.wormhole_sequence.to_account_info(),
                    ctx.accounts.wormhole_fee_collector.to_account_info(),
                    ctx.accounts.clock.to_account_info(),
                    ctx.accounts.rent.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                    ctx.accounts.core_bridge.to_account_info(),
                    ctx.accounts.token_program.to_account_info()
                ],
                &[&[
                    SEED_PREFIX_CUSTODIAN.as_ref(),
                    &[*ctx.bumps.get("custodian").unwrap()]
                ]]
            )?;

        } else {
            //Native Token
        }


        Ok(())
    }

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        let msg = verify_conductor_vaa(&ctx.accounts.core_bridge_vaa, PAYLOAD_SALE_ABORTED)?;
        ctx.accounts.sale.parse_sale_aborted(&msg.payload)?;

        Ok(())
    }
    pub fn claim_refund(ctx: Context<ClaimFunds>) -> Result<()> {
        let sale = &ctx.accounts.sale;
        require!(sale.is_aborted(), ContributorError::SaleNotAborted);

        let to_account = &ctx.accounts.buyer_ata;
        let mint = token::accessor::mint(&to_account.to_account_info())?;
        let (idx, _) = sale.get_total_info(&mint)?;
        let refund = ctx.accounts.buyer.claim_refund(idx)?;
        require!(refund > 0, ContributorError::NothingToClaim);

        let from_account = &ctx.accounts.custodian_ata;
        let transfer_authority = &ctx.accounts.custodian;

        // spl transfer refund
        /*
        // this doesn't work in devnet?
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

        invoke_signed(
            &spl_token::instruction::transfer(
                &token::ID,
                &from_account.key(),
                &to_account.key(),
                &transfer_authority.key(),
                &[&transfer_authority.key()],
                refund,
            )?,
            &ctx.accounts.to_account_infos(),
            &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
        )?;
        Ok(())
    }

    pub fn claim_allocation(ctx: Context<ClaimFunds>) -> Result<()> {
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        let to_account = &ctx.accounts.buyer_ata;
        let mint = token::accessor::mint(&to_account.to_account_info())?;
        let allocation = ctx.accounts.buyer.claim_allocation(&sale.totals)?;
        require!(allocation > 0, ContributorError::NothingToClaim);

        let from_account = &ctx.accounts.custodian_ata;
        let transfer_authority = &ctx.accounts.custodian;

        // spl transfer refund
        /*
        // this doesn't work in devnet?
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

        invoke_signed(
            &spl_token::instruction::transfer(
                &token::ID,
                &from_account.key(),
                &to_account.key(),
                &transfer_authority.key(),
                &[&transfer_authority.key()],
                allocation,
            )?,
            &ctx.accounts.to_account_infos(),
            &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
        )?;
        Ok(())
    }
}
