use crate::constants::*;
use crate::state::*;
use crate::wormhole::*;
use anchor_lang::prelude::*;
use std::str::FromStr;

#[derive(Accounts)]
#[instruction(conductor_chain:u16, conductor_address:Vec<u8>)]
pub struct CreateContributor<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Contributor::MAXIMUM_SIZE,
        seeds = [
            b"contributor".as_ref(),
            conductor_address.as_ref()
        ],
        bump
    )]
    pub contributor: Account<'info, Contributor>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeSale<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        init,
        seeds = [
            SEED_PREFIX_SALE.as_bytes(), // can we remove as_ref()?
            &get_sale_id(&core_bridge_vaa)?,
        ],
        payer = owner,
        bump,
        space = Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = verify_conductor_vaa(&core_bridge_vaa, &contributor, PAYLOAD_SALE_INIT)?,
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// TODO
#[derive(Accounts)]
#[instruction(token_pubkey: Pubkey)]
pub struct CreateTokenCustody<'info> {
    pub contributor: Account<'info, Contributor>,
}

/// Contribute is used for buyers to contribute collateral
#[derive(Accounts)]
#[instruction(sale_id: Vec<u8>, token_index: u8, amount: u64)]
pub struct Contribute<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        init_if_needed,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
        ],
        bump,
        space=Sale::MAXIMUM_SIZE,
        payer=owner
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
            &owner.key().as_ref(),
        ],
        bump = buyer.bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

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
        bump = sale.bump,
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
#[instruction(sale_id: Vec<u8>, token_index: u8)]
pub struct ClaimAllocation<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
        ],
        bump = sale.bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
            &[token_index],
            owner.key().as_ref(),
        ],
        bump = buyer.bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// AbortSale is used for aborting sale so users can claim refunds (min raise not met)
#[derive(Accounts)]
pub struct AbortSale<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &get_sale_id(&core_bridge_vaa)?.as_ref(),
        ],
        bump = sale.bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = verify_conductor_vaa(&core_bridge_vaa, &contributor, PAYLOAD_SALE_ABORTED)?,
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ClaimRefund is used for buyers to collect their contributed collateral back
#[derive(Accounts)]
#[instruction(sale_id: Vec<u8>, token_index: u8)]
pub struct ClaimRefund<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
        ],
        bump = sale.bump,
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        mut,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            &sale_id.as_ref(),
            &[token_index],
            owner.key().as_ref(),
        ],
        bump = buyer.bump,
    )]
    pub buyer: Account<'info, Buyer>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

fn verify_conductor_vaa<'info>(
    vaa_account: &AccountInfo<'info>,
    contributor_account: &Account<'info, Contributor>,
    payload_type: u8,
) -> Result<bool> {
    let msg = get_message_data(&vaa_account)?;
    Ok(
        vaa_account.to_account_info().owner == &Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
            && msg.emitter_chain == contributor_account.conductor_chain
            && msg.emitter_address == contributor_account.conductor_address
            && msg.payload[0] == payload_type,
    )
}

fn get_sale_id<'info>(vaa_account: &AccountInfo<'info>) -> Result<Vec<u8>> {
    Ok(get_message_data(&vaa_account)?.payload[1..33].into())
}
