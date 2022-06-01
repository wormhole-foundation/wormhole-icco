use crate::constants::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{clock, rent};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use std::str::FromStr;

use crate::{
    constants::{SEED_PREFIX_BUYER, SEED_PREFIX_CUSTODIAN, SEED_PREFIX_SALE},
    state::{Buyer, Custodian, Sale},
    wormhole::get_message_data,
};

#[derive(Accounts)]
pub struct CreateCustodian<'info> {
    #[account(
        init,
        payer = owner,
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
        space = 8 + Custodian::MAXIMUM_SIZE,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeSale<'info> {
    pub custodian: Account<'info, Custodian>,

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

    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Contribute is used for buyers to contribute collateral
#[derive(Accounts)]
#[instruction(amount:u64)]
pub struct Contribute<'info> {
    #[account(
        mut,
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

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

    /// CHECK: Buyer Associated Token Account
    #[account(mut)]
    pub custodian_ata: AccountInfo<'info>,

    /// CHECK: Buyer Associated Token Account
    #[account(mut)]
    pub buyer_ata: Account<'info, TokenAccount>,

    /// CHECK: Custodian Associated Token Account
    //pub custodian_ata: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,

    rent: Sysvar<'info, Rent>,
}

/// TODO: write something here
#[derive(Accounts)]
pub struct AttestContributions<'info> {
    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &sale.id,
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,

    #[account(
        constraint = core_bridge.key() == Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub core_bridge: AccountInfo<'info>,
    #[account(
        seeds = [
            b"Bridge".as_ref()
        ],
        bump,
        seeds::program = Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap(),
        mut
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub wormhole_config: AccountInfo<'info>,
    #[account(
        seeds = [
            b"fee_collector".as_ref()
        ],
        bump,
        seeds::program = Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap(),
        mut
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub wormhole_fee_collector: AccountInfo<'info>,
    #[account(
        seeds = [
            b"emitter".as_ref(),
        ],
        bump,
        mut
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub wormhole_derived_emitter: AccountInfo<'info>,
    #[account(
        seeds = [
            b"Sequence".as_ref(),
            wormhole_derived_emitter.key().to_bytes().as_ref()
        ],
        bump,
        seeds::program = Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap(),
        mut
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub wormhole_sequence: AccountInfo<'info>,
    #[account(mut)]
    pub wormhole_message_key: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = clock.key() == clock::id()
    )]
    /// CHECK: The account constraint will make sure it's the right clock var
    pub clock: AccountInfo<'info>,
    #[account(
        constraint = rent.key() == rent::id()
    )]
    /// CHECK: The account constraint will make sure it's the right rent var
    pub rent: AccountInfo<'info>,
}

/// SealSale is used to close sale so users can claim allocations (min raise met)
#[derive(Accounts)]
pub struct SealSale<'info> {
    #[account(
        mut,
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &get_sale_id(&core_bridge_vaa)?,
        ],
        bump,
    )]
    pub sale: Account<'info, Sale>,

    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/*
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
    #[account(
        mut,
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

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
