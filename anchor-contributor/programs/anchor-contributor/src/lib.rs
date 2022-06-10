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

declare_id!("BQJjZVdMHjHEePYa5nkB8bMNtxVg3Sff9KgS7x62B1pZ");  // Solana devnet same

#[program]
pub mod anchor_contributor {
    use super::*;
    use anchor_lang::solana_program::{
        borsh::try_from_slice_unchecked,
        instruction::Instruction,
        program::{invoke, invoke_signed},
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
        ctx.accounts.custodian.new(&ctx.accounts.owner.key())
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

        // The VAA encoded the Custodian's associated token account for the sale token. We
        // need to verify that the ATA that we have in the context is the same one the message
        // refers to.
        require!(
            sale.associated_sale_token_address == ctx.accounts.custodian_sale_token_acct.key(),
            ContributorError::InvalidVaaPayload
        );

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
        // We need to use the buyer's associated token account to help us find the token index
        // for this particular mint he wishes to contribute.
        let sale = &ctx.accounts.sale;
        let buyer_token_acct = &ctx.accounts.buyer_token_acct;
        let (idx, asset) = sale.get_total_info(&buyer_token_acct.mint)?;
        let token_index = asset.token_index;

        // If the buyer account wasn't initialized before, we will do so here. This initializes
        // the state for all of this buyer's contributions.
        let buyer = &mut ctx.accounts.buyer;
        if !buyer.initialized {
            buyer.initialize(sale.totals.len());
        }

        // We verify the KYC signature by encoding specific details of this contribution the
        // same way the KYC entity signed for the transaction. If we cannot recover the KYC's
        // public key using ecdsa recovery, we cannot allow the contribution to continue.
        //
        // We also refer to the buyer (owner) of this instruction as the transfer_authority
        // for the SPL transfer that will happen at the end of all the accounting processing.
        let transfer_authority = &ctx.accounts.owner;
        sale.verify_kyc_authority(
            token_index,
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
        let sale = &mut ctx.accounts.sale;
        sale.update_total_contributions(clock.unix_timestamp, token_index, amount)?;

        // And we do the same with the Buyer account.
        buyer.contribute(idx, amount)?;

        // Finally transfer SPL tokens from the buyer's associated token account to the
        // custodian's associated token account.
        let custodian_token_acct = &ctx.accounts.custodian_token_acct;
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

        // For some reason, using the anchor_spl library did not work on
        // Solana devnet for one of our test trials, so we're keeping the
        // native instruction here in case we need it.
        //
        // invoke(
        //     &spl_token::instruction::transfer(
        //         &token::ID,
        //         &buyer_token_acct.key(),
        //         &custodian_token_acct.key(),
        //         &transfer_authority.key(),
        //         &[&transfer_authority.key()],
        //         amount,
        //     )?,
        //     &ctx.accounts.to_account_infos(),
        // )?;

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
        invoke(
            &transfer(
                &ctx.accounts.owner.key(),
                &ctx.accounts.wormhole_fee_collector.key(),
                bridge_data.config.fee,
            ),
            &ctx.accounts.to_account_infos(),
        )?;

        // Post VAA to our Wormhole message account so it can be signed by the guardians
        // and received by the conductor.
        invoke_signed(
            &Instruction {
                program_id: ctx.accounts.core_bridge.key(),
                accounts: vec![
                    AccountMeta::new(ctx.accounts.wormhole_config.key(), false),
                    AccountMeta::new(ctx.accounts.vaa_msg_acct.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.wormhole_derived_emitter.key(), true),
                    AccountMeta::new(ctx.accounts.wormhole_sequence.key(), false),
                    AccountMeta::new(ctx.accounts.owner.key(), true),
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
                    &[ctx.bumps["vaa_msg_acct"]],
                ],
                &[
                    &b"emitter".as_ref(),
                    &[ctx.bumps["wormhole_derived_emitter"]],
                ],
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
        let sale = &mut ctx.accounts.sale;
        let msg = ctx
            .accounts
            .custodian
            .parse_and_verify_conductor_vaa_and_sale(
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
    /// *** NOTE: This is still being built and needs to be tested. ***
    pub fn bridge_sealed_contributions(
        ctx: Context<BridgeSealedContribution>,
        token_idx: u8,
    ) -> Result<()> {
        // We need to make sure that the sale is sealed before we can consider bridging
        // collateral over to the conductor.
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        let conductor_chain = Custodian::conductor_chain()?;
        let conductor_address = Custodian::conductor_address()?;

        let asset = &sale.totals.get(token_idx as usize).unwrap();
        let mint = asset.mint;
        let amount = asset.contributions - asset.excess_contributions;
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
                    AccountMeta::new(ctx.accounts.payer.key(), true),
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
                        amount,
                        fee: 0,
                        target_address: sale.recipient,
                        target_chain: sale.token_chain,
                    },
                )
                    .try_to_vec()?,
            };

            invoke_signed(
                &send_wrapped_ix,
                &[
                    ctx.accounts.payer.to_account_info(),
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
            let send_native_ix = Instruction {
                program_id: ctx.accounts.token_bridge.key(),
                accounts: vec![
                    AccountMeta::new(ctx.accounts.payer.key(), true),
                    AccountMeta::new_readonly(ctx.accounts.token_config.key(), false),
                    AccountMeta::new(custody_ata.key(), false),
                    AccountMeta::new(token_acc.mint, false),
                    AccountMeta::new_readonly(ctx.accounts.custody_key.key(), false),
                    AccountMeta::new_readonly(
                        ctx.accounts.token_bridge_authority_signer.key(),
                        false,
                    ),
                    AccountMeta::new_readonly(ctx.accounts.custody_signer_key.key(), false),
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
                    TRANSFER_NATIVE_INSTRUCTION,
                    TransferData {
                        nonce: ctx.accounts.custodian.nonce,
                        amount: amount,
                        fee: 0_u64,
                        target_address: sale.recipient,
                        target_chain: sale.token_chain,
                    },
                )
                    .try_to_vec()?,
            };

            invoke_signed(
                &send_native_ix,
                &[
                    ctx.accounts.payer.to_account_info(),
                    ctx.accounts.token_config.to_account_info(),
                    custody_ata.to_account_info(),
                    ctx.accounts.mint_token_account.to_account_info(),
                    ctx.accounts.custody_key.to_account_info(),
                    ctx.accounts.token_bridge_authority_signer.to_account_info(),
                    ctx.accounts.custody_signer_key.to_account_info(),
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
                &[&[]],
            )?;
        }

        // TODO: need to check custodian ata to see if there are enough funds
        // for transferring excess back to buyers
        // require!(custodian_ata.amount >= asset.excess_contributions, Bork)

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
        for (total, custodian_token_acct, buyer_token_acct) in
            izip!(totals, custodian_token_accts, buyer_token_accts)
        {
            // Verify the authority of the custodian's associated token account
            require!(
                token::accessor::authority(&custodian_token_acct)? == transfer_authority.key(),
                ContributorError::InvalidAccount
            );
            // And verify the authority of the buyer's associated token account
            require!(
                token::accessor::authority(&buyer_token_acct)? == owner.key(),
                ContributorError::InvalidAccount
            );
            // We need to verify that the mints are the same between the two
            // associated token accounts. After which, we will use the sale account
            // to find the correct index to reference in the buyer account.
            let mint = token::accessor::mint(&custodian_token_acct)?;
            require!(
                token::accessor::mint(&buyer_token_acct)? == mint,
                ContributorError::InvalidAccount
            );
            let (idx, _) = sale.get_total_info(&mint)?;

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
                    &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
                ),
                refund,
            )?;

            // For some reason, using the anchor_spl library did not work on
            // Solana devnet for one of our test trials, so we're keeping the
            // native instruction here in case we need it.
            //
            // invoke_signed(
            //     &spl_token::instruction::transfer(
            //         &token::ID,
            //         &custodian_token_acct.key(),
            //         &buyer_token_acct.key(),
            //         &transfer_authority.key(),
            //         &[&transfer_authority.key()],
            //         refund,
            //     )?,
            //     &all_accts,
            //     &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
            // )?;
        }

        // Finish instruction.
        Ok(())
    }

    /// Instruction to claim allocations from a sealed sale. Only the buyer account needs to
    /// be mutable so we can change its state.
    ///
    /// The buyer account will determine the total allocations reserved for the buyer based on
    /// how much he has contributed to the sale (relative to the total contributions found in
    /// the sale account) and mark its allocation as claimed. The same calculation is used to
    /// determine how much excess of each contribution the buyer is allowed. It will also mark
    /// the state of each contribution as ExcessClaimed.
    ///
    /// There is one transfer for the total allocation and n transfers for the excess
    /// contributions, depending on however many tokens a user has contributed to the sale.
    pub fn claim_allocation<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ClaimAllocation<'info>>,
    ) -> Result<()> {
        // We need to make sure that the sale is actually sealed in order to use this
        // instruction. If it isn't, we cannot continue.
        let sale = &ctx.accounts.sale;
        require!(sale.is_sealed(), ContributorError::SaleNotSealed);

        // first deal with the allocation
        let custodian_sale_token_acct = &ctx.accounts.custodian_sale_token_acct;
        let buyer_sale_token_acct = &ctx.accounts.buyer_sale_token_acct;

        // compute allocation
        let totals = &sale.totals;
        let allocation = ctx.accounts.buyer.claim_allocation(totals)?;
        require!(allocation > 0, ContributorError::NothingToClaim);

        // spl transfer allocation
        let transfer_authority = &ctx.accounts.custodian;
        let custodian_bump = ctx.bumps["custodian"];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: custodian_sale_token_acct.to_account_info(),
                    to: buyer_sale_token_acct.to_account_info(),
                    authority: transfer_authority.to_account_info(),
                },
                &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[custodian_bump]]],
            ),
            allocation,
        )?;

        // For some reason, using the anchor_spl library did not work on
        // Solana devnet for one of our test trials, so we're keeping the
        // native instruction here in case we need it.
        //
        // invoke_signed(
        //     &spl_token::instruction::transfer(
        //         &token::ID,
        //         &custodian_sale_token_acct.key(),
        //         &buyer_sale_token_acct.key(),
        //         &transfer_authority.key(),
        //         &[&transfer_authority.key()],
        //         allocation,
        //     )?,
        //     &ctx.accounts.to_account_infos(),
        //     &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[custodian_bump]]],
        // )?;

        // We pass as an extra argument remaining accounts. The first n accounts are
        // the custodian's associated token accounts for each accepted token for the sale.
        // The second n accounts are the buyer's respective associated token accounts.
        // We need to verify that this context has the correct number of ATAs.
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
        for (total, custodian_token_acct, buyer_token_acct) in
            izip!(totals, custodian_token_accts, buyer_token_accts)
        {
            require!(
                token::accessor::authority(&custodian_token_acct)? == transfer_authority.key(),
                ContributorError::InvalidAccount
            );
            // And verify the authority of the buyer's associated token account
            require!(
                token::accessor::authority(&buyer_token_acct)? == owner.key(),
                ContributorError::InvalidAccount
            );
            // We need to verify that the mints are the same between the two
            // associated token accounts. After which, we will use the sale account
            // to find the correct index to reference in the buyer account.
            let mint = token::accessor::mint(&custodian_token_acct)?;
            require!(
                token::accessor::mint(&buyer_token_acct)? == mint,
                ContributorError::InvalidAccount
            );
            let (idx, _) = sale.get_total_info(&mint)?;

            // Now calculate the excess contribution and transfer to the
            // buyer's associated token account if there is any amount calculated.
            let excess = buyer.claim_excess(idx, total)?;
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
                    &[&[SEED_PREFIX_CUSTODIAN.as_bytes(), &[custodian_bump]]],
                ),
                excess,
            )?;

            // For some reason, using the anchor_spl library did not work on
            // Solana devnet for one of our test trials, so we're keeping the
            // native instruction here in case we need it.
            //
            // invoke_signed(
            //     &spl_token::instruction::transfer(
            //         &token::ID,
            //         &custodian_token_acct.key(),
            //         &buyer_token_acct.key(),
            //         &transfer_authority.key(),
            //         &[&transfer_authority.key()],
            //         excess,
            //     )?,
            //     &all_accts,
            //     &[&[&SEED_PREFIX_CUSTODIAN.as_bytes(), &[ctx.bumps["custodian"]]]],
            // )?;
        }

        // Finish instruction.
        Ok(())
    }
}
