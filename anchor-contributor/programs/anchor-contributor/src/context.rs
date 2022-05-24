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
pub struct InitSale<'info> {
    pub contributor: Account<'info, Contributor>,

    #[account(
        init,
        seeds = [
            SEED_PREFIX_SALE.as_bytes().as_ref(), // can we remove as_ref()?
            //get_message_data(&core_bridge_vaa)?.sequence.to_be_bytes().as_ref()
            &get_sale_id(&core_bridge_vaa)?,
        ],
        payer = owner,
        bump,
        space = Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    #[account(constraint = verify_conductor(&core_bridge_vaa, &contributor)?)]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// ModifySale is used for sealing and aborting sales
#[derive(Accounts)]
pub struct ModifySale<'info> {
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

    #[account(constraint = verify_conductor(&core_bridge_vaa, &contributor)?)]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

fn verify_conductor<'info>(
    vaa_account: &AccountInfo<'info>,
    contributor_account: &Account<'info, Contributor>,
) -> Result<bool> {
    let msg = get_message_data(&vaa_account)?;
    Ok(
        vaa_account.to_account_info().owner == &Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap()
            && msg.emitter_chain == contributor_account.conductor_chain
            && msg.emitter_address == contributor_account.conductor_address,
    )
}

fn get_sale_id<'info>(vaa_account: &AccountInfo<'info>) -> Result<Vec<u8>> {
    Ok(get_message_data(&vaa_account)?.payload[1..33].into())
}
