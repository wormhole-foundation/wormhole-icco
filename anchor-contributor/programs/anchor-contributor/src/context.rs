use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use std::str::FromStr;
use crate::wormhole::*;

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
            SEED_PREFIX_SALE.as_bytes().as_ref(),
            (PostedMessageData::try_from_slice(&core_bridge_vaa.data.borrow())?.0).sequence.to_be_bytes().as_ref()
        ],
        payer = owner,
        bump,
        space = Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = core_bridge_vaa.to_account_info().owner == &Pubkey::from_str(CORE_BRIDGE_ADDRESS).unwrap(),
        constraint = (PostedMessageData::try_from_slice(&core_bridge_vaa.data.borrow())?.0).emitter_chain == contributor.conductor_chain,
        constraint = (PostedMessageData::try_from_slice(&core_bridge_vaa.data.borrow())?.0).emitter_address == contributor.conductor_address
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}