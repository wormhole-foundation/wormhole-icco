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

declare_id!("NEXaa1zDNLJ9AqwEd7LipQTge4ygeVVHyr8Tv7X2FCn");

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
    use anchor_spl::token;

    use itertools::izip;
    use state::custodian::Custodian;

    /// Instruction to create the custodian account (which we referr to as `custodian`)
    /// in all instruction contexts found in contexts.rs.
    pub fn create_custodian(ctx: Context<CreateCustodian>) -> Result<()> {
        // We save the "owner" in the custodian account. But the custodian does not
        // need to be mutated in future interactions with the program.
        ctx.accounts.custodian.new()?;

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

        // Check that sale_token_mint is legitimate
        let mint_acct_info = &ctx.accounts.sale_token_mint;

        // We assume that the conductor is sending a legitimate token, whether it is
        // a Solana native token or minted by the token bridge program.
        if sale.token_chain == CHAIN_ID {
            // In the case that the token chain is Solana, we will attempt to deserialize the Mint
            // account and be on our way. If for any reason we cannot, we will block the sale
            // as a precaution.
            match mint_acct_info.try_borrow_data() {
                Err(_) => {
                    sale.block_contributions();
                }
                Ok(data) => {
                    let mut bf: &[u8] = &data;
                    match token::Mint::try_deserialize(&mut bf) {
                        Err(_) => {
                            sale.block_contributions();
                        }
                        Ok(mint_info) => {
                            // Mint account passed into context needs to be correct
                            require!(
                                mint_acct_info.key().to_bytes() == sale.token_address,
                                ContributorError::InvalidSaleToken
                            );

                            // We want to save the sale token's mint information in the Sale struct. Most
                            // important of which is the number of decimals for this SPL token. The sale
                            // token that lives on the conductor chain can have a different number of decimals.
                            // Given how Portal works in attesting tokens, the foreign decimals will always
                            // be at least the amount found here.
                            sale.set_sale_token_mint_info(
                                &mint_acct_info.key(),
                                &mint_info,
                                &ctx.accounts.custodian.key(),
                            )?;
                        }
                    }
                }
            };
        } else {
            // In the case that the token chain isn't Solana, we will assume that the token
            // has not been attestd yet if there is no account found.
            let mut buf: &[u8] = &mint_acct_info
                .try_borrow_data()
                .map_err(|_| ContributorError::SaleTokenNotAttested)?;
            let mint_info = token::Mint::try_deserialize(&mut buf)
                .map_err(|_| ContributorError::SaleTokenNotAttested)?;

            // since the token chain ID is not Solana's, presumably the token bridge program
            // minted this token. But as a precaution, we will double-check the mint address
            // derivation. If for some reason the address doesn't line up with how we derive
            // it using the seeds, we will block contributions.
            let (mint, _) = Pubkey::find_program_address(
                &[
                    b"wrapped",
                    &sale.token_chain.to_be_bytes(),
                    &sale.token_address,
                ],
                &ctx.accounts.token_bridge.key(),
            );

            // Mint account passed into context needs to be correct
            require!(
                mint_acct_info.key() == mint,
                ContributorError::InvalidSaleToken
            );

            // We want to save the sale token's mint information in the Sale struct. Most
            // important of which is the number of decimals for this SPL token. The sale
            // token that lives on the conductor chain can have a different number of decimals.
            // Given how Portal works in attesting tokens, the foreign decimals will always
            // be at least the amount found here.
            sale.set_sale_token_mint_info(&mint, &mint_info, &ctx.accounts.custodian.key())?;
        }

        // We need to verify that the accepted tokens are actual mints.
        // We set status to invalid on bad ones.
        let assets = &mut sale.totals;
        let accepted_mints = &ctx.remaining_accounts[..];
        require!(
            assets.len() == accepted_mints.len(),
            ContributorError::InvalidRemainingAccounts
        );
        for (asset, accepted_mint_acct_info) in izip!(assets, accepted_mints) {
            // If the remaining account does not match the key of the accepted asset's mint,
            // throw because wrong account is passed into instruction.
            require!(
                accepted_mint_acct_info.key() == asset.mint,
                ContributorError::InvalidRemainingAccounts,
            );

            // Check whether we should invalidate the accepted asset.
            match *accepted_mint_acct_info.owner == token::ID {
                false => {
                    // If the remaining account is not owned by token program, it is invalid.
                    asset.invalidate();
                }
                _ => {
                    match accepted_mint_acct_info.try_borrow_data() {
                        Err(_) => {
                            // If the remaining account is not a real account, it is invalid.
                            asset.invalidate();
                        }
                        Ok(data) => {
                            // If the remaining account does not deserialize to Mint account, it is invalid.
                            let mut bf: &[u8] = &data;
                            if token::Mint::try_deserialize(&mut bf).is_err() {
                                asset.invalidate();
                            }
                        }
                    }
                }
            };
        }

        // Write sale id in program log for reference.
        msg!("sale: {}", hex::encode(&sale.id));

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

        // Check that sale on Solana is not blocked.
        let sale = &ctx.accounts.sale;
        require!(
            !sale.is_blocked_contributions(),
            ContributorError::SaleContributionsAreBlocked
        );

        // Find indices used for contribution accounting
        // We need to use the buyer's associated token account to help us find the token index
        // for this particular mint he wishes to contribute.
        let (idx, asset) = sale.get_total_info(&ctx.accounts.accepted_mint.key())?;

        // This should never happen because the ATA will not deserialize correctly,
        // but we have this here just in case.
        require!(
            asset.is_valid_for_contribution(),
            ContributorError::AssetContributionsAreBlocked
        );

        // If the buyer account wasn't initialized before, we will do so here. This initializes
        // the state for all of this buyer's contributions.
        let buyer = &mut ctx.accounts.buyer;
        if !buyer.initialized {
            buyer.initialize(sale.totals.len());
        }

        // We verify the KYC signature by encoding specific details of this contribution the
        // same way the KYC entity signed for the transaction. If we cannot recover the KYC's
        // public key using ecdsa recovery, we cannot allow the contribution to continue.
        sale.verify_kyc_authority(
            asset.token_index,
            amount,
            &transfer_authority.key(),
            buyer.contributions[idx].amount,
            &kyc_signature,
        )?;

        // We need to grab the current block's timestamp and verify that the buyer is allowed
        // to contribute now. A user cannot contribute before the sale has started. If all the
        // sale checks pass, the Sale's total contributions uptick to reflect this buyer's
        // contribution.
        let clock = Clock::get()?;
        ctx.accounts
            .sale
            .update_total_contributions(clock.unix_timestamp, idx, amount)?;

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
            if let Some(ata) = asset
                .deserialize_associated_token_account(custodian_token_acct, &custodian.key())?
            {
                require!(
                    ata.amount >= asset.contributions,
                    ContributorError::InsufficientFunds
                );
            };

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

        let amount = asset.contributions - asset.excess_contributions;

        if amount > 0 {
            // We will need the custodian seeds to sign one to two transactions
            let custodian_seeds = &[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]];

            // We need to delegate authority to the token bridge program's
            // authority signer to spend the custodian's token
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
                nonce: 0,
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
                    &[b"meta", accepted_mint_key.as_ref()],
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
                            AccountMeta::new_readonly(
                                ctx.accounts.token_bridge_config.key(),
                                false,
                            ),
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
                            AccountMeta::new_readonly(
                                ctx.accounts.token_bridge_config.key(),
                                false,
                            ),
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
        }

        // Even if there is nothing to transfer, we will change the state.
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
            // Now calculate the refund and transfer to the buyer's associated
            // token account if there is any amount to refund.
            let refund = buyer.claim_refund(idx)?;
            if refund == 0 {
                continue;
            }

            // Verify remaining accounts are associated token accounts.
            // Either both are valid or both are invalid. If only one
            // is valid, then there is something wrong.
            // In the case that both are invalid, this is when the accepted
            // token itself is invalid.
            match (
                asset.deserialize_associated_token_account(
                    custodian_token_acct,
                    &ctx.accounts.custodian.key(),
                )?,
                asset.deserialize_associated_token_account(buyer_token_acct, &owner.key())?,
            ) {
                (Some(_), Some(_)) => {
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            token::Transfer {
                                from: custodian_token_acct.to_account_info(),
                                to: buyer_token_acct.to_account_info(),
                                authority: transfer_authority.to_account_info(),
                            },
                            &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
                        ),
                        refund,
                    )?;
                }
                (None, None) => {
                    // This scenario is expected for an invalid token because
                    // neither will have an associated token account
                }
                _ => return Err(ContributorError::InvalidAccount.into()),
            };
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
                &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
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
            // Now calculate the excess contribution and transfer to the
            // buyer's associated token account if there is any amount calculated.
            let excess = buyer.claim_excess(idx, asset)?;
            if excess == 0 {
                continue;
            }

            // Verify remaining accounts are associated token accounts.
            // Either both are valid or both are invalid. If only one
            // is valid, then there is something wrong.
            // In the case that both are invalid, this is when the accepted
            // token itself is invalid.
            match (
                asset.deserialize_associated_token_account(
                    custodian_token_acct,
                    &ctx.accounts.custodian.key(),
                )?,
                asset.deserialize_associated_token_account(buyer_token_acct, &owner.key())?,
            ) {
                (Some(_), Some(_)) => {
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            token::Transfer {
                                from: custodian_token_acct.to_account_info(),
                                to: buyer_token_acct.to_account_info(),
                                authority: transfer_authority.to_account_info(),
                            },
                            &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
                        ),
                        excess,
                    )?;
                }
                (None, None) => {
                    // This scenario is expected for an invalid token because
                    // neither will have an associated token account
                }
                _ => return Err(ContributorError::InvalidAccount.into()),
            };
        }

        // Finish instruction.
        Ok(())
    }

    /// Instruction to change a sale's KYC authority. This parses an inbound signed VAA
    /// sent by the conductor.
    ///
    /// Once the VAA is parsed and verified, we deserialize the new KYC authority
    /// public key and save it to the sale account.
    ///
    /// Users can continue using the `contribute` instruction to contribute accepted
    /// tokens to the sale, but they must now be signed by the new KYC authority.
    pub fn update_kyc_authority(ctx: Context<UpdateKycAuthority>) -> Result<()> {
        // We verify that the signed VAA has the same sale information as the Sale
        // account we pass into the context. It also needs to be emitted from the
        // conductor we know.
        let sale = &mut ctx.accounts.sale;
        let msg = ctx
            .accounts
            .custodian
            .parse_and_verify_conductor_vaa_and_sale(
                &ctx.accounts.core_bridge_vaa,
                PAYLOAD_KYC_AUTHORITY_UPDATED,
                sale.id,
            )?;

        // Finish the instruction by updating the KYC authority if the sale is still active.
        let clock = Clock::get()?;
        sale.parse_kyc_authority_updated(clock.unix_timestamp, &msg.payload)
    }
}
