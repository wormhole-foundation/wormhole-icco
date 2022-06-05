use crate::constants::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{clock, rent};
use anchor_spl::associated_token::*;
use anchor_spl::token::{Mint, Token, TokenAccount, ID};
use std::str::FromStr;

use crate::{
    constants::{SEED_PREFIX_BUYER, SEED_PREFIX_CUSTODIAN, SEED_PREFIX_SALE},
    state::{Buyer, Custodian, Sale},
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
    #[account(
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(
        init,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(),
            &Custodian::get_sale_id_from_vaa(&core_bridge_vaa)?,
        ],
        payer = owner,
        bump,
        space = 8 + Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = core_bridge_vaa.owner.key() == Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,
    pub sale_token_mint: Account<'info, Mint>,

    #[
        account(
            constraint = custodian_sale_token_acct.mint == sale_token_mint.key(),
            constraint = custodian_sale_token_acct.owner == custodian.key(),
        )
    ]
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Contribute is used for buyers to contribute collateral
#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(
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

    #[account(
        mut,
        constraint = buyer_token_acct.mint == custodian_token_acct.mint,
        constraint = buyer_token_acct.owner == owner.key(),
    )]
    pub buyer_token_acct: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = custodian_token_acct.owner == custodian.key(),
    )]
    pub custodian_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

/// TODO: write something here
#[derive(Accounts)]
pub struct AttestContributions<'info> {
    #[account(
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

#[derive(Accounts)]
pub struct BridgeSealedContribution<'info> {
    #[account(
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
        constraint = custody_ata.owner == &AssociatedToken::id()
    )]
    /// CHECK: Check if owned by ATA Program
    pub custody_ata: AccountInfo<'info>,

    #[account(
        constraint = mint_token_account.owner == &ID
    )]
    /// CHECK: Check if owned by SPL Account
    pub mint_token_account: AccountInfo<'info>,

    /// CHECK: Nullable account
    pub wrapped_meta_key: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,

    #[account(
        constraint = token_bridge.key() == Pubkey::from_str(TOKEN_BRIDGE_ADDRESS).unwrap()
    )]
    /// CHECK: Checked in account constraints
    pub token_bridge: AccountInfo<'info>,
    #[account(
        seeds=[b"mint_signer"],
        bump,
        seeds::program = token_bridge.key()
    )]
    /// CHECK: We know what we're doing Mr. Anchor ;)
    pub token_mint_signer: AccountInfo<'info>,

    #[account(
        seeds=[b"authority_signer"],
        bump,
        seeds::program = token_bridge.key()
    )]
    /// CHECK: Token Bridge Authority Signer
    pub token_bridge_authority_signer: AccountInfo<'info>,

    #[account(
        seeds = [
            b"config".as_ref()
        ],
        bump,
        seeds::program = Pubkey::from_str(TOKEN_BRIDGE_ADDRESS).unwrap(),
        mut
    )]
    /// CHECK: If someone passes in the wrong account, Guardians won't read the message
    pub token_config: AccountInfo<'info>,

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

    pub token_program: Program<'info, Token>,
}

/// AbortSale is used for aborting sale so users can claim refunds (min raise not met)
#[derive(Accounts)]
pub struct AbortSale<'info> {
    #[account(
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
        constraint = core_bridge_vaa.owner.key() == Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// SealSale is used for closing successful sale so users can claim allocations (min raise met)
#[derive(Accounts)]
pub struct SealSale<'info> {
    #[account(
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
        constraint = core_bridge_vaa.owner.key() == Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(
        constraint = custodian_sale_token_acct.mint == sale.sale_token_mint,
        constraint = custodian_sale_token_acct.owner == custodian.key(),
    )]
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ClaimAllocations is used for buyer <> custodian interaction to retrieve allocations
/// and excess from custodian
#[derive(Accounts)]
pub struct ClaimAllocation<'info> {
    #[account(
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(
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
            &owner.key().as_ref(),
        ],
        bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(
        mut,
        constraint = buyer_sale_token_acct.mint == sale.sale_token_mint,
        constraint = buyer_sale_token_acct.owner == owner.key(),
    )]
    pub buyer_sale_token_acct: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = custodian_sale_token_acct.mint == sale.sale_token_mint,
        constraint = custodian_sale_token_acct.owner == custodian.key(),
    )]
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

/// ClaimRefunds is used for buyer <> custodian interaction to retrieve refunds from custodian
#[derive(Accounts)]
pub struct ClaimRefunds<'info> {
    #[account(
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(
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
            &owner.key().as_ref(),
        ],
        bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
