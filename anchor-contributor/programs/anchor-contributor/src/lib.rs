use anchor_lang::prelude::*;
use anchor_lang::solana_program::borsh::try_from_slice_unchecked;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_lang::solana_program::sysvar::*;
use anchor_spl::*;

mod constants;
mod context;
mod error;
mod state;
mod token_bridge;
mod wormhole;

use constants::*;
use context::*;
use error::*;
use token_bridge::*;
use wormhole::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod anchor_contributor {
    use super::*;
    use itertools::izip;

    pub fn create_custodian(ctx: Context<CreateCustodian>) -> Result<()> {
        ctx.accounts.custodian.new(&ctx.accounts.owner.key())
    }

    pub fn init_sale(ctx: Context<InitializeSale>) -> Result<()> {
        let msg = ctx.accounts.custodian.parse_and_verify_conductor_vaa(
            &ctx.accounts.core_bridge_vaa,
            PAYLOAD_SALE_INIT_SOLANA,
        )?;
        let sale = &mut ctx.accounts.sale;

        // now parse vaa
        sale.parse_sale_init(&msg.payload)?;

        // the associated token address we deserialized from the payload
        // should agree with the token account we passed into the context
        require!(
            sale.associated_sale_token_address == ctx.accounts.custodian_sale_token_acct.key(),
            ContributorError::IncorrectVaaPayload
        );

        // save sale token mint info
        sale.set_sale_token_mint_info(
            &ctx.accounts.sale_token_mint.key(),
            &ctx.accounts.sale_token_mint,
        )?;

        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        let from_account = &ctx.accounts.buyer_token_acct;

        // find token_index
        let sale = &mut ctx.accounts.sale;
        let token_index = sale.get_token_index(&from_account.mint)?;

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

        let to_account = &ctx.accounts.custodian_token_acct;
        let transfer_authority = &ctx.accounts.owner;

        // spl transfer contribution
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    to: to_account.to_account_info(),
                    from: from_account.to_account_info(),
                    authority: transfer_authority.to_account_info(),
                },
            ),
            amount,
        )?;

        /*
        invoke(
            &spl_token::instruction::transfer(
                &token::ID,
                &ctx.accounts.buyer_token_acct.key(),
                &ctx.accounts.custodian_token_acct.key(),
                &transfer_authority.key(),
                &[&transfer_authority.key()],
                amount,
            )?,
            &ctx.accounts.to_account_infos(),
        )?;
        */
        Ok(())
    }

    pub fn attest_contributions(ctx: Context<AttestContributions>) -> Result<()> {
        let clock = Clock::get()?;
        let vaa_payload = ctx
            .accounts
            .sale
            .serialize_contributions(clock.unix_timestamp)?;

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

    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        let msg = ctx
            .accounts
            .custodian
            .parse_and_verify_conductor_vaa_and_sale(
                &ctx.accounts.core_bridge_vaa,
                PAYLOAD_SALE_SEALED,
                sale.id,
            )?;

        // all good
        sale.parse_sale_sealed(&msg.payload)?;

        // TODO: check balance of the sale token on the contract to make sure
        // we have enough for claimants
        let total_allocations: u64 = sale.totals.iter().map(|total| total.allocations).sum();
        let custodian_sale_token_acct = &ctx.accounts.custodian_sale_token_acct;
        require!(
            custodian_sale_token_acct.amount >= total_allocations,
            ContributorError::InsufficientFunds
        );

        Ok(())
        /*
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
        */
    }

    pub fn bridge_sealed_contributions(
        ctx: Context<BridgeSealedContribution>,
        token_idx: u8,
    ) -> Result<()> {
        // by this point, the sale is sealed
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        let custodian = &ctx.accounts.custodian;
        let conductor_chain = custodian.conductor_chain;
        let conductor_address = custodian.conductor_address;

        let asset = &sale.totals.get(token_idx as usize).unwrap();
        let mint = asset.mint;
        let amount = asset.contributions;
        let recipient = sale.recipient;
        // token bridge transfer this amount over to conductor_address on conductor_chain to recipient
        let custody_ata = &ctx.accounts.custody_ata;
        let mut token_account_data: &[u8] = &ctx.accounts.mint_token_account.data.borrow();
        let token_acc: token::TokenAccount =
            token::TokenAccount::try_deserialize(&mut token_account_data)?;
        let wrapped_meta_key = &ctx.accounts.wrapped_meta_key;

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
                    AccountMeta::new_readonly(
                        ctx.accounts.token_bridge_authority_signer.key(),
                        false,
                    ),
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
                    },
                )
                    .try_to_vec()?,
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
                    ctx.accounts.token_program.to_account_info(),
                ],
                &[&[
                    SEED_PREFIX_CUSTODIAN.as_ref(),
                    &[*ctx.bumps.get("custodian").unwrap()],
                ]],
            )?;
        } else {
            //Native Token
        }

        Ok(())
    }

    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        let msg = ctx
            .accounts
            .custodian
            .parse_and_verify_conductor_vaa_and_sale(
                &ctx.accounts.core_bridge_vaa,
                PAYLOAD_SALE_ABORTED,
                sale.id,
            )?;

        // all good
        sale.parse_sale_aborted(&msg.payload)?;

        Ok(())
    }

    pub fn claim_refunds<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimRefunds<'info>>,
    ) -> Result<()> {
        let sale = &ctx.accounts.sale;
        require!(sale.is_aborted(), ContributorError::SaleNotAborted);

        let totals = &sale.totals;
        let num_accepted = totals.len();
        let token_accts = &ctx.remaining_accounts;
        require!(
            token_accts.len() == 2 * num_accepted,
            ContributorError::InvalidRemainingAccounts
        );
        let custodian_token_accts = &token_accts[..num_accepted];
        let buyer_token_accts = &token_accts[num_accepted..];

        let owner = &ctx.accounts.owner;
        let transfer_authority = &ctx.accounts.custodian;

        // Collect ALL account Infos to pass to trasfer.
        let mut all_accts = ctx.accounts.to_account_infos();
        all_accts.extend_from_slice(&ctx.remaining_accounts);

        let buyer = &mut ctx.accounts.buyer;
        for (total, from_acct, to_acct) in izip!(totals, custodian_token_accts, buyer_token_accts) {
            require!(
                token::accessor::authority(&from_acct)? == transfer_authority.key(),
                ContributorError::InvalidAccount
            );
            require!(
                token::accessor::authority(&to_acct)? == owner.key(),
                ContributorError::InvalidAccount
            );
            let mint = token::accessor::mint(&to_acct)?;
            let (idx, _) = sale.get_total_info(&mint)?;

            let refund = buyer.claim_refund(idx)?;
            if refund == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        to: to_acct.to_account_info(),
                        from: from_acct.to_account_info(),
                        authority: transfer_authority.to_account_info(),
                    },
                    &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
                ),
                refund,
            )?;

            /*
            invoke_signed(
                &spl_token::instruction::transfer(
                    &token::ID,
                    &from_acct.key(),
                    &to_acct.key(),
                    &transfer_authority.key(),
                    &[&transfer_authority.key()],
                    refund,
                )?,
                &all_accts,
                &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
            )?;
            */
        }
        Ok(())
    }

    pub fn claim_allocation<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimAllocation<'info>>,
    ) -> Result<()> {
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        // first deal with the allocation
        let to_account = &ctx.accounts.buyer_sale_token_acct;
        require!(
            to_account.mint == sale.sale_token_mint,
            ContributorError::InvalidAccount
        );
        let from_account = &ctx.accounts.custodian_sale_token_acct;
        require!(
            from_account.mint == sale.sale_token_mint,
            ContributorError::InvalidAccount
        );

        let totals = &sale.totals;

        // compute allocation
        let allocation = ctx.accounts.buyer.claim_allocation(totals)?;
        require!(allocation > 0, ContributorError::NothingToClaim);

        // and make sure there are sufficient funds
        require!(
            from_account.amount >= allocation,
            ContributorError::InsufficientFunds
        );

        // spl transfer allocation
        let transfer_authority = &ctx.accounts.custodian;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    to: to_account.to_account_info(),
                    from: from_account.to_account_info(),
                    authority: transfer_authority.to_account_info(),
                },
                &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
            ),
            allocation,
        )?;

        /*
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
        */

        // now compute excess and transfer
        let num_accepted = totals.len();
        let token_accts = &ctx.remaining_accounts;
        require!(
            token_accts.len() == 2 * num_accepted,
            ContributorError::InvalidRemainingAccounts
        );
        let custodian_token_accts = &token_accts[..num_accepted];
        let buyer_token_accts = &token_accts[num_accepted..];

        let owner = &ctx.accounts.owner;
        let transfer_authority = &ctx.accounts.custodian;

        // Collect ALL account Infos to pass to trasfer.
        let mut all_accts = ctx.accounts.to_account_infos();
        all_accts.extend_from_slice(&ctx.remaining_accounts);

        let buyer = &mut ctx.accounts.buyer;
        for (total, from_acct, to_acct) in izip!(totals, custodian_token_accts, buyer_token_accts) {
            require!(
                token::accessor::authority(&from_acct)? == transfer_authority.key(),
                ContributorError::InvalidAccount
            );
            require!(
                token::accessor::authority(&to_acct)? == owner.key(),
                ContributorError::InvalidAccount
            );
            let mint = token::accessor::mint(&to_acct)?;
            let (idx, _) = sale.get_total_info(&mint)?;

            let excess = buyer.claim_excess(idx, total)?;
            if excess == 0 {
                continue;
            }

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        to: to_acct.to_account_info(),
                        from: from_acct.to_account_info(),
                        authority: transfer_authority.to_account_info(),
                    },
                    &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
                ),
                excess,
            )?;

            /*
            invoke_signed(
                &spl_token::instruction::transfer(
                    &token::ID,
                    &from_acct.key(),
                    &to_acct.key(),
                    &transfer_authority.key(),
                    &[&transfer_authority.key()],
                    excess,
                )?,
                &all_accts,
                &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
            )?;
            */
        }
        Ok(())
    }
}
