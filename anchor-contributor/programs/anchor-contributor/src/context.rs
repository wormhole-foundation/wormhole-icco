use anchor_lang::prelude::*;

use crate::{
    constants::{SEED_PREFIX_BUYER, SEED_PREFIX_SALE},
    state::{Buyer, Sale, TokenCustodian},
    wormhole::get_message_data,
};

#[derive(Accounts)]
pub struct CreateTokenCustodian<'info> {
    #[account(
        init,
        payer = owner,
        seeds = [
            b"icco-token-custodian".as_ref(),
        ],
        bump,
        space = 8 + TokenCustodian::MAXIMUM_SIZE,
    )]
    pub token_custodian: Account<'info, TokenCustodian>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeSale<'info> {
    pub token_custodian: Account<'info, TokenCustodian>,

    #[account(
        init,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &get_sale_id(&core_bridge_vaa)?,
        ],
        payer = owner,
        bump,
        space = 8 + Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    /*
    #[account(
        constraint = verify_conductor_vaa(&core_bridge_vaa, &contributor, PAYLOAD_SALE_INIT_SOLANA)?,
    )]
    */
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Contribute is used for buyers to contribute collateral
#[derive(Accounts)]
pub struct Contribute<'info> {
    pub token_custodian: Account<'info, TokenCustodian>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &sale.id,
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        init_if_needed,
        seeds = [
            SEED_PREFIX_BUYER.as_bytes(),
            &sale.id,
            &owner.key().as_ref(),
        ],
        payer = owner,
        bump,
        space = 8 + Buyer::MAXIMUM_SIZE,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/*
/// SealSale is used to close sale so users can claim allocations (min raise met)
#[derive(Accounts)]
pub struct SealSale<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &get_sale_id(&core_bridge_vaa)?.as_ref(),
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = verify_conductor_vaa(&core_bridge_vaa, &contributor, PAYLOAD_SALE_SEALED)?,
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ClaimAllocation is used for buyers to collect their contributed collateral back
#[derive(Accounts)]
#[instruction(sale_id: Vec<u8>)]
pub struct ClaimAllocation<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
            owner.key().as_ref(),
        ],
        bump = buyer.bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}
*/

/// AbortSale is used for aborting sale so users can claim refunds (min raise not met)
#[derive(Accounts)]
pub struct AbortSale<'info> {
    pub token_custodian: Account<'info, TokenCustodian>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &get_sale_id(&core_bridge_vaa)?,
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    /*
    #[account(
        constraint = verify_conductor_vaa(&core_bridge_vaa, &contributor, PAYLOAD_SALE_ABORTED)?,
    )]
    */
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ClaimRefund is used for buyers to collect their contributed collateral back
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    //pub contributor: Account<'info, Contributor>,
    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &sale.id,
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_BUYER.as_bytes(),
            &sale.id,
            owner.key().as_ref(),
        ],
        bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

fn get_sale_id<'info>(vaa_account: &AccountInfo<'info>) -> Result<Vec<u8>> {
    Ok(get_message_data(&vaa_account)?.payload[1..33].into())
}
