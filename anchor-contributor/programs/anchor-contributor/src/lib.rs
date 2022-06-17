use anchor_lang::prelude::*;

mod constants;
mod context;
mod cryptography;
mod env;
mod error;
mod state;
mod token_bridge;
mod wormhole;

use constants::*;
use context::*;
use error::*;
use token_bridge::*;
use wormhole::*;

declare_id!("Efzc4SLs1ZdTPRq95oWxdMUr9XiX5M14HABwHpvrc9Fm"); // Solana devnet same

#[program]
pub mod anchor_contributor {
    use super::*;
    use anchor_lang::solana_program::{
        borsh::try_from_slice_unchecked,
        instruction::Instruction,
        program::{invoke, invoke_signed},
        program_option::COption,
        system_instruction::transfer,
        sysvar::*,
    };
    use anchor_spl::*;
    use itertools::izip;
    use state::custodian::Custodian;

    /// Instruction to create the custodian account (which we referr to as `custodian`)
    /// in all instruction contexts found in contexts.rs.
    pub fn create_custodian(ctx: Context<CreateCustodian>) -> Result<()> {
        // We save the "owner" in the custodian account. But the custodian does not
        // need to be mutated in future interactions with the program.
        ctx.accounts.custodian.new()?;

        // Store pre-computed bump.
        ctx.accounts.custodian.seed_bump = ctx.bumps["custodian"];

        // Store wormhole PKs
        ctx.accounts.custodian.wormhole_pubkey = ctx.accounts.wormhole.key();
        ctx.accounts.custodian.token_bridge_pubkey = ctx.accounts.token_bridge.key();

        // Create fixed accounts PDAs so we can simply check addresses in subsequent calls.
        (ctx.accounts.custodian.custody_signer_key, _) =
            Pubkey::find_program_address(&[b"custody_signer"], &ctx.accounts.token_bridge.key());
        (ctx.accounts.custodian.mint_signer_key, _) =
            Pubkey::find_program_address(&[b"mint_signer"], &ctx.accounts.token_bridge.key());
        (ctx.accounts.custodian.authority_signer_key, _) =
            Pubkey::find_program_address(&[b"authority_signer"], &ctx.accounts.token_bridge.key());
        (ctx.accounts.custodian.bridge_config_key, _) =
            Pubkey::find_program_address(&[b"config"], &ctx.accounts.token_bridge.key());
        (ctx.accounts.custodian.wormhole_config_key, _) =
            Pubkey::find_program_address(&[b"Bridge"], &ctx.accounts.wormhole.key());
        (ctx.accounts.custodian.fee_collector_key, _) =
            Pubkey::find_program_address(&[b"fee_collector"], &ctx.accounts.wormhole.key());
        (ctx.accounts.custodian.wormhole_emitter_key, _) =
            Pubkey::find_program_address(&[b"emitter"], &ctx.accounts.token_bridge.key());

        (ctx.accounts.custodian.wormhole_sequence_key, _) = Pubkey::find_program_address(
            &[
                b"Sequence",
                ctx.accounts.custodian.wormhole_emitter_key.as_ref(),
            ],
            &ctx.accounts.wormhole.key(),
        );

        Ok(())
    }

    /// Instruction to initialize a sale. This parses an inbound signed VAA sent
    /// by the conductor. A Sale account will be created at this point seeded by
    /// the sale ID found in the signed VAA.
    ///
    /// Included with this transaction is the sale token's mint public key and the
    /// custodian's associated token account for the sale token. We need to verify
    /// that the sale token info provided in the context is the same as what we parse
    /// from the signed VAA.
    pub fn init_sale(ctx: Context<InitSale>) -> Result<()> {
        // We need to verify that the signed VAA was emitted from the conductor program
        // that the contributor program knows.
        let msg = ctx.accounts.custodian.parse_and_verify_conductor_vaa(
            &ctx.accounts.core_bridge_vaa,
            PAYLOAD_SALE_INIT_SOLANA,
        )?;

        // Once verified, we deserialize the VAA payload to initialize the Sale
        // account with information relevant to perform future actions regarding
        // this particular sale. It uses a 32-byte ID generated from the VAA as its
        // identifier.
        let sale = &mut ctx.accounts.sale;
        sale.parse_sale_init(&msg.payload)?;

        // Store pre-computed bump.
        sale.seed_bump = ctx.bumps["sale"];

        // The VAA encoded the Custodian's associated token account for the sale token. We
        // need to verify that the ATA that we have in the context is the same one the message
        // refers to.
        require!(
            sale.associated_sale_token_address == ctx.accounts.custodian_sale_token_acct.key(),
            ContributorError::InvalidVaaPayload
        );

        // We need to verify that the accepted tokens are actual mints.
        let assets = &sale.totals;
        let accepted_mints = &ctx.remaining_accounts[..];
        require!(
            assets.len() == accepted_mints.len(),
            ContributorError::InvalidRemainingAccounts
        );

        for (asset, accepted_mint_acct_info) in izip!(assets, accepted_mints) {
            require!(
                *accepted_mint_acct_info.owner == token::ID,
                ContributorError::InvalidAcceptedToken
            );
            require!(
                accepted_mint_acct_info.key() == asset.mint,
                ContributorError::InvalidAcceptedToken
            );

            // try_deserialize calls Mint::unpack, which checks if
            // SPL is_intialized is true
            let mut bf: &[u8] = &accepted_mint_acct_info.try_borrow_data()?;
            let _ = token::Mint::try_deserialize(&mut bf)?;
        }

        // We want to save the sale token's mint information in the Sale struct. Most
        // important of which is the number of decimals for this SPL token. The sale
        // token that lives on the conductor chain can have a different number of decimals.
        // Given how Portal works in attesting tokens, the foreign decimals will always
        // be at least the amount found here.
        sale.set_sale_token_mint_info(
            &ctx.accounts.sale_token_mint.key(),
            &ctx.accounts.sale_token_mint,
        )?;

        // Finish instruction.
        Ok(())
    }

    /// Instruction to contribute to an ongoing sale. The sale account needs to be mutable so we
    /// can uptick the total contributions for this sale. A buyer account will be created if it
    /// hasn't been already from a previous contribution, seeded by the sale ID and the buyer's
    /// public key.
    ///
    /// As a part of this instruction, we need to verify that the contribution is allowed by checking
    /// a signature provided from an outside source (a know-your-customer entity).
    ///
    /// Once everything is verified, the sale and buyer accounts are updated to reflect this
    /// contribution amount and the contribution will be transferred from the buyer's
    /// associated token account to the custodian's associated token account.
    pub fn contribute(ctx: Context<Contribute>, amount: u64, kyc_signature: Vec<u8>) -> Result<()> {
        // buyer's token account -> custodian's associated token account
        // These references will be used throughout the instruction
        let buyer_token_acct = &ctx.accounts.buyer_token_acct;
        let custodian_token_acct = &ctx.accounts.custodian_token_acct;

        // We refer to the buyer (owner) of this instruction as the transfer_authority
        // for the SPL transfer that will happen at the end of all the accounting processing.
        let transfer_authority = &ctx.accounts.owner;

        // Find indices used for contribution accounting
        let (idx, token_index) = {
            let sale = &ctx.accounts.sale;

            // We need to use the buyer's associated token account to help us find the token index
            // for this particular mint he wishes to contribute.
            let (idx, asset) = sale.get_total_info(&buyer_token_acct.mint)?;

            // If the buyer account wasn't initialized before, we will do so here. This initializes
            // the state for all of this buyer's contributions.
            let buyer = &mut ctx.accounts.buyer;
            if !buyer.initialized {
                buyer.initialize(sale.totals.len());
            }

            let token_index = asset.token_index;

            // We verify the KYC signature by encoding specific details of this contribution the
            // same way the KYC entity signed for the transaction. If we cannot recover the KYC's
            // public key using ecdsa recovery, we cannot allow the contribution to continue.
            sale.verify_kyc_authority(
                token_index,
                amount,
                &transfer_authority.key(),
                buyer.contributions[idx].amount,
                &kyc_signature,
            )?;

            (idx, token_index)
        };

        // We need to grab the current block's timestamp and verify that the buyer is allowed
        // to contribute now. A user cannot contribute before the sale has started. If all the
        // sale checks pass, the Sale's total contributions uptick to reflect this buyer's
        // contribution.
        let clock = Clock::get()?;
        ctx.accounts
            .sale
            .update_total_contributions(clock.unix_timestamp, token_index, amount)?;

        // And we do the same with the Buyer account.
        ctx.accounts.buyer.contribute(idx, amount)?;

        // Finally transfer SPL tokens from the buyer's associated token account to the
        // custodian's associated token account. Verify the custodian's associated
        // token account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: buyer_token_acct.to_account_info(),
                    to: custodian_token_acct.to_account_info(),
                    authority: transfer_authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // Finish instruction.
        Ok(())
    }

    /// Instruction to attest contributions when the sale's contribution period expires. We cannot
    /// attest contributions prior.
    ///
    /// As a part of this instruction, we send a VAA to the conductor so it can factor this
    /// contributor's contributions, making sure that the minimum raise is met.
    pub fn attest_contributions(ctx: Context<AttestContributions>) -> Result<()> {
        // Use the current block's time to check to see if we are allowed to attest contributions.
        // If we can, serialize the VAA payload.
        let clock = Clock::get()?;
        let vaa_payload = ctx
            .accounts
            .sale
            .serialize_contributions(clock.unix_timestamp)?;

        // Prepare to send attest contribution payload via Wormhole.
        let bridge_data: BridgeData =
            try_from_slice_unchecked(&ctx.accounts.wormhole_config.data.borrow_mut())?;

        // Prior to sending the VAA, we need to pay Wormhole a fee in order to
        // use it.
        let payer = &ctx.accounts.payer;
        invoke(
            &transfer(
                &payer.key(),
                &ctx.accounts.wormhole_fee_collector.key(),
                bridge_data.config.fee,
            ),
            &ctx.accounts.to_account_infos(),
        )?;

        // Post VAA to our Wormhole message account so it can be signed by the guardians
        // and received by the conductor.
        invoke_signed(
            &Instruction {
                program_id: ctx.accounts.wormhole.key(),
                accounts: vec![
                    AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                    AccountMeta::new(ctx.accounts.wormhole_message.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.wormhole_emitter.key(), true),
                    AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                    AccountMeta::new(payer.key(), true),
                    AccountMeta::new(ctx.accounts.wormhole_fee_collector.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.clock.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
                    AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                ],
                data: (
                    wormhole::Instruction::PostMessage,
                    PostMessageData {
                        nonce: 0, // should only be emitted once, so no need for nonce
                        payload: vaa_payload,
                        consistency_level: wormhole::ConsistencyLevel::Confirmed,
                    },
                )
                    .try_to_vec()?,
            },
            &ctx.accounts.to_account_infos(),
            &[
                &[
                    &b"attest-contributions".as_ref(),
                    &ctx.accounts.sale.id,
                    &[ctx.bumps["wormhole_message"]],
                ],
                &[&b"emitter".as_ref(), &[ctx.bumps["wormhole_emitter"]]],
            ],
        )?;

        // Finish instruction.
        Ok(())
    }

    /// Instruction to seal the current sale. This parses an inbound signed VAA sent
    /// by the conductor.
    ///
    /// Once the VAA is parsed and verified, we need to mark the sale as sealed so we
    /// can invoke the program to bridge the contributed collateral over to the
    /// conductor program. We would have liked to do the bridging of all collateral
    /// in one instruction, but there are too many accounts (we need three or four per
    /// SPL token we bridge, depending on the kind of token).
    ///
    /// Users can use the `claim_allocation` instruction to claim their calculated
    /// allocation of sale token and any excess contributions they have made.
    pub fn seal_sale(ctx: Context<SealSale>) -> Result<()> {
        // We verify that the signed VAA has the same sale information as the Sale
        // account we pass into the context. It also needs to be emitted from the
        // conductor we know.
        let custodian = &ctx.accounts.custodian;
        let sale = &mut ctx.accounts.sale;
        let msg = custodian.parse_and_verify_conductor_vaa_and_sale(
            &ctx.accounts.core_bridge_vaa,
            PAYLOAD_SALE_SEALED,
            sale.id,
        )?;

        // After verifying the VAA, save the allocation and excess contributions per
        // accepted asset. Change the state from Active to Sealed.
        sale.parse_sale_sealed(&msg.payload)?;

        // Prior to sealing the sale, the sale token needed to be bridged to the custodian's
        // associated token account. We need to make sure that there are enough allocations
        // in the custodian's associated token account for distribution to all of the
        // participants of the sale. If there aren't, we cannot allow the instruction to
        // continue.
        let total_allocations: u64 = sale.totals.iter().map(|total| total.allocations).sum();
        require!(
            ctx.accounts.custodian_sale_token_acct.amount >= total_allocations,
            ContributorError::InsufficientFunds
        );

        // We pass as an extra argument remaining accounts. The first n accounts are
        // the custodian's associated token accounts for each accepted token for the sale.
        // The second n accounts are the buyer's respective associated token accounts.
        // We need to verify that this context has the correct number of ATAs.
        let totals = &mut sale.totals;
        let custodian_token_accts = &ctx.remaining_accounts[..];
        require!(
            custodian_token_accts.len() == totals.len(),
            ContributorError::InvalidRemainingAccounts
        );

        // We will mutate the buyer's accounting and state for each contributed mint.
        for (asset, custodian_token_acct) in izip!(totals, custodian_token_accts) {
            // re-derive custodian_token_acct address and check it.
            // Verifies the authority and mint of the custodian's associated token account
            let ata = asset
                .deserialize_associated_token_account(custodian_token_acct, &custodian.key())?;
            require!(
                ata.amount >= asset.contributions,
                ContributorError::InsufficientFunds
            );

            asset.prepare_for_transfer();
        }

        // Finish instruction.
        Ok(())
    }

    /// Instruction to bridge all of the sealed contributions to the conductor, one SPL token
    /// at a time.
    ///
    /// At the end of the instruction, we need to make sure that the contributions that remain
    /// on the custodian's associated token account are at least as much needed to transfer
    /// back to all of the market participants when they claim for their allocations using
    /// the `claim_allocation` instruction.
    ///
    /// *** NOTE: Token Bridge Wrapped Transfers are Un-Tested. ***
    pub fn bridge_sealed_contribution(ctx: Context<BridgeSealedContribution>) -> Result<()> {
        // We need to make sure that the sale is sealed before we can consider bridging
        // collateral over to the conductor.
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        let custodian_token_acct = &ctx.accounts.custodian_token_acct;

        let accepted_mint_acct = &ctx.accounts.accepted_mint;
        let accepted_mint_key = &accepted_mint_acct.key();
        let (idx, asset) = sale.get_total_info(accepted_mint_key)?;

        let custodian = &ctx.accounts.custodian;

        // Check if asset is in the correct state after sealing the sale
        require!(
            asset.is_ready_for_transfer(),
            ContributorError::TransferNotAllowed
        );

        // We will need the custodian seeds to sign one to two transactions
        let custodian_seeds = &[SEED_PREFIX_CUSTODIAN.as_bytes(), &[custodian.seed_bump]];

        // We need to delegate authority to the token bridge program's
        // authority signer to spend the custodian's token
        let amount = asset.contributions - asset.excess_contributions;
        let authority_signer = &ctx.accounts.authority_signer;
        token::approve(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Approve {
                    to: custodian_token_acct.to_account_info(),
                    delegate: authority_signer.to_account_info(),
                    authority: custodian.to_account_info(),
                },
                &[&custodian_seeds[..]],
            ),
            amount,
        )?;

        let transfer_data = TransferData {
            nonce: ctx.accounts.custodian.nonce,
            amount,
            fee: 0,
            target_address: sale.recipient,
            target_chain: Custodian::conductor_chain()?,
        };

        let token_bridge_key = &ctx.accounts.token_bridge.key();

        // We will need the wormhole message seeds for both types
        // of token bridge transfers.
        let wormhole_message_seeds = &[
            &b"bridge-sealed".as_ref(),
            &sale.id[..],
            accepted_mint_key.as_ref(),
            &[ctx.bumps["wormhole_message"]],
        ];

        // There are two instructions to bridge assets depending on
        // whether the accepted token's mint authority is the token
        // bridge program's.
        let token_mint_signer = &ctx.accounts.token_mint_signer;
        let minted_by_token_bridge = match accepted_mint_acct.mint_authority {
            COption::Some(authority) => authority == token_mint_signer.key(),
            _ => false,
        };

        if minted_by_token_bridge {
            let wrapped_meta_key = &ctx.accounts.custody_or_wrapped_meta.key();

            // Because we don't have an account check for wrapped_meta,
            // let's do it here.
            let (derived_key, _) = Pubkey::find_program_address(
                &[b"meta".as_ref(), accepted_mint_key.as_ref()],
                token_bridge_key,
            );
            require!(
                *wrapped_meta_key == derived_key,
                ContributorError::InvalidAccount
            );

            // Now bridge
            invoke_signed(
                &Instruction {
                    program_id: *token_bridge_key,
                    accounts: vec![
                        AccountMeta::new(ctx.accounts.payer.key(), true),
                        AccountMeta::new_readonly(ctx.accounts.token_bridge_config.key(), false),
                        AccountMeta::new(custodian_token_acct.key(), false),
                        AccountMeta::new_readonly(custodian.key(), true),
                        AccountMeta::new(*accepted_mint_key, false),
                        AccountMeta::new_readonly(*wrapped_meta_key, false),
                        AccountMeta::new_readonly(authority_signer.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_message.key(), true),
                        AccountMeta::new_readonly(ctx.accounts.wormhole_emitter.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_fee_collector.key(), false),
                        AccountMeta::new_readonly(clock::id(), false),
                        AccountMeta::new_readonly(rent::id(), false),
                        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                        AccountMeta::new_readonly(ctx.accounts.wormhole.key(), false),
                        AccountMeta::new_readonly(spl_token::id(), false),
                    ],
                    data: (TRANSFER_WRAPPED_INSTRUCTION, transfer_data).try_to_vec()?,
                },
                &ctx.accounts.to_account_infos(),
                &[&custodian_seeds[..], &wormhole_message_seeds[..]],
            )?;
        } else {
            let token_bridge_custody = &ctx.accounts.custody_or_wrapped_meta;

            // Because we don't have an account check for token_bridge_custody,
            // let's do it here.
            let (derived_key, _) =
                Pubkey::find_program_address(&[accepted_mint_key.as_ref()], token_bridge_key);
            require!(
                token_bridge_custody.key() == derived_key,
                ContributorError::InvalidAccount
            );

            // Now bridge
            invoke_signed(
                &Instruction {
                    program_id: *token_bridge_key,
                    accounts: vec![
                        AccountMeta::new(ctx.accounts.payer.key(), true),
                        AccountMeta::new_readonly(ctx.accounts.token_bridge_config.key(), false),
                        AccountMeta::new(custodian_token_acct.key(), false),
                        AccountMeta::new(*accepted_mint_key, false),
                        AccountMeta::new(token_bridge_custody.key(), false),
                        AccountMeta::new_readonly(authority_signer.key(), false),
                        AccountMeta::new_readonly(ctx.accounts.custody_signer.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_message.key(), true),
                        AccountMeta::new_readonly(ctx.accounts.wormhole_emitter.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                        AccountMeta::new(ctx.accounts.wormhole_fee_collector.key(), false),
                        AccountMeta::new_readonly(clock::id(), false),
                        AccountMeta::new_readonly(rent::id(), false),
                        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                        AccountMeta::new_readonly(ctx.accounts.wormhole.key(), false),
                        AccountMeta::new_readonly(spl_token::id(), false),
                    ],
                    data: (TRANSFER_NATIVE_INSTRUCTION, transfer_data).try_to_vec()?,
                },
                &ctx.accounts.to_account_infos(),
                &[&wormhole_message_seeds[..]],
            )?;
        }

        ctx.accounts.sale.totals[idx].set_transferred();

        // Finish instruction.
        Ok(())
    }

    /// Instruction to abort the current sale. This parses an inbound signed VAA sent
    /// by the conductor.
    ///
    /// Once the VAA is parsed and verified, we mark the sale as aborted.
    ///
    /// Users can use the `claim_refunds` instruction to claim however much they have
    /// contributed to the sale.
    pub fn abort_sale(ctx: Context<AbortSale>) -> Result<()> {
        // We verify that the signed VAA has the same sale information as the Sale
        // account we pass into the context. It also needs to be emitted from the
        // conductor we know.
        let sale = &mut ctx.accounts.sale;
        let msg = ctx
            .accounts
            .custodian
            .parse_and_verify_conductor_vaa_and_sale(
                &ctx.accounts.core_bridge_vaa,
                PAYLOAD_SALE_ABORTED,
                sale.id,
            )?;

        // Finish the instruction by changing the status of the sale to Aborted.
        sale.parse_sale_aborted(&msg.payload)
    }

    /// Instruction to claim refunds from an aborted sale. Only the buyer account needs to
    /// be mutable so we can change its state.
    ///
    /// The buyer account will copy what it knows as the buyer's contributions per SPL token
    /// and assign that value to its excess for record keeping, marking the state of each
    /// contribution as RefundClaimed.
    ///
    /// There are n transfers for the refunds, depending on however many tokens a user has
    /// contributed to the sale.
    pub fn claim_refunds<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimRefunds<'info>>,
    ) -> Result<()> {
        // We need to make sure that the sale is actually aborted in order to use this
        // instruction. If it isn't, we cannot continue.
        let sale = &ctx.accounts.sale;
        require!(sale.is_aborted(), ContributorError::SaleNotAborted);

        // We pass as an extra argument remaining accounts. The first n accounts are
        // the custodian's associated token accounts for each accepted token for the sale.
        // The second n accounts are the buyer's respective associated token accounts.
        // We need to verify that this context has the correct number of ATAs.
        let totals = &sale.totals;
        let num_accepted = totals.len();
        let token_accts = &ctx.remaining_accounts;
        require!(
            token_accts.len() == 2 * num_accepted,
            ContributorError::InvalidRemainingAccounts
        );
        let custodian_token_accts = &token_accts[..num_accepted];
        let buyer_token_accts = &token_accts[num_accepted..];

        // The owner reference is used to verify the authority for buyer's associated
        // token accounts. And the transfer_authority is used for the SPL transfer.
        let owner = &ctx.accounts.owner;
        let transfer_authority = &ctx.accounts.custodian;

        // This is used in case we need to use a native solana transfer.
        //
        // let mut all_accts = ctx.accounts.to_account_infos();
        // all_accts.extend_from_slice(&ctx.remaining_accounts);

        // We will mutate the buyer's accounting and state for each contributed mint.
        let buyer = &mut ctx.accounts.buyer;
        for (idx, (asset, custodian_token_acct, buyer_token_acct)) in
            izip!(totals, custodian_token_accts, buyer_token_accts).enumerate()
        {
            // Verify the custodian's associated token account
            asset.deserialize_associated_token_account(
                custodian_token_acct,
                &ctx.accounts.custodian.key(),
            )?;

            // And verify the buyer's token account
            asset.deserialize_token_account(buyer_token_acct, &owner.key())?;

            // Now calculate the refund and transfer to the buyer's associated
            // token account if there is any amount to refund.
            let refund = buyer.claim_refund(idx)?;
            if refund == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: custodian_token_acct.to_account_info(),
                        to: buyer_token_acct.to_account_info(),
                        authority: transfer_authority.to_account_info(),
                    },
                    &[&[
                        SEED_PREFIX_CUSTODIAN.as_bytes(),
                        &[ctx.accounts.custodian.seed_bump],
                    ]],
                ),
                refund,
            )?;
        }

        // Finish instruction.
        Ok(())
    }

    /// Instruction to claim allocations from a sealed sale. Only the buyer account needs to
    /// be mutable so we can change its state.
    ///
    /// The buyer account will determine the total allocations reserved for the buyer based on
    /// how much he has contributed to the sale (relative to the total contributions found in
    /// the sale account) and mark its allocation as claimed.
    ///
    /// There is one transfer for the total allocation.
    pub fn claim_allocation<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimAllocation<'info>>,
    ) -> Result<()> {
        // We need to make sure that the sale is actually sealed in order to use this
        // instruction. If it isn't, we cannot continue.
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        let clock = Clock::get()?;
        require!(
            sale.allocation_unlocked(clock.unix_timestamp),
            ContributorError::AllocationsLocked
        );

        let custodian_sale_token_acct = &ctx.accounts.custodian_sale_token_acct;
        let buyer_sale_token_acct = &ctx.accounts.buyer_sale_token_acct;

        // compute allocation
        let totals = &sale.totals;
        let allocation = ctx.accounts.buyer.claim_allocation(totals)?;
        require!(allocation > 0, ContributorError::NothingToClaim);

        // spl transfer allocation
        let transfer_authority = &ctx.accounts.custodian;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: custodian_sale_token_acct.to_account_info(),
                    to: buyer_sale_token_acct.to_account_info(),
                    authority: transfer_authority.to_account_info(),
                },
                &[&[
                    SEED_PREFIX_CUSTODIAN.as_bytes(),
                    &[ctx.accounts.custodian.seed_bump],
                ]],
            ),
            allocation,
        )?;

        // Finish instruction.
        Ok(())
    }

    /// Instruction to claim excess contributions from a sealed sale. Only the buyer
    /// account needs to be mutable so we can change its state.
    ///
    /// The buyer account will determine how much excess of each contribution the buyer is
    /// allowed based on how much he has contributed to the sale (relative to the total
    /// contributions found in the sale account). It will also mark the state of each
    /// contribution as ExcessClaimed.
    ///
    /// There are n transfers for the excesses, depending on however many tokens a user has
    /// contributed to the sale.
    pub fn claim_excesses<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimExcesses<'info>>,
    ) -> Result<()> {
        // We need to make sure that the sale is actually aborted in order to use this
        // instruction. If it isn't, we cannot continue.
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        // We pass as an extra argument remaining accounts. The first n accounts are
        // the custodian's associated token accounts for each accepted token for the sale.
        // The second n accounts are the buyer's respective associated token accounts.
        // We need to verify that this context has the correct number of ATAs.
        let totals = &sale.totals;
        let num_accepted = totals.len();
        let token_accts = &ctx.remaining_accounts;
        require!(
            token_accts.len() == 2 * num_accepted,
            ContributorError::InvalidRemainingAccounts
        );
        let custodian_token_accts = &token_accts[..num_accepted];
        let buyer_token_accts = &token_accts[num_accepted..];

        // The owner reference is used to verify the authority for buyer's associated
        // token accounts. And the transfer_authority is used for the SPL transfer.
        let owner = &ctx.accounts.owner;
        let transfer_authority = &ctx.accounts.custodian;

        // This is used in case we need to use a native solana transfer.
        //
        // let mut all_accts = ctx.accounts.to_account_infos();
        // all_accts.extend_from_slice(&ctx.remaining_accounts);

        // We will mutate the buyer's accounting and state for each contributed mint.
        let buyer = &mut ctx.accounts.buyer;
        for (idx, (asset, custodian_token_acct, buyer_token_acct)) in
            izip!(totals, custodian_token_accts, buyer_token_accts).enumerate()
        {
            // Verify the custodian's associated token account
            asset.deserialize_associated_token_account(
                custodian_token_acct,
                &ctx.accounts.custodian.key(),
            )?;

            // And verify the buyer's token account
            asset.deserialize_token_account(buyer_token_acct, &owner.key())?;

            // Now calculate the excess contribution and transfer to the
            // buyer's associated token account if there is any amount calculated.
            let excess = buyer.claim_excess(idx, asset)?;
            if excess == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: custodian_token_acct.to_account_info(),
                        to: buyer_token_acct.to_account_info(),
                        authority: transfer_authority.to_account_info(),
                    },
                    &[&[
                        SEED_PREFIX_CUSTODIAN.as_bytes(),
                        &[ctx.accounts.custodian.seed_bump],
                    ]],
                ),
                excess,
            )?;
        }

        // Finish instruction.
        Ok(())
    }
}
