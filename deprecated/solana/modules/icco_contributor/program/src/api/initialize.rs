#![allow(dead_code)]
#![allow(unused_must_use)]
#![allow(unused_imports)]

use std::mem::size_of_val;
use crate::{
    accounts::ConfigAccount,
//    types::*,
};

use solana_program::msg;

use solana_program::{
    account_info::AccountInfo,
    // program_error::ProgramError,
    pubkey::Pubkey,
};
use solitaire::{
    CreationLamports::Exempt,
    *,
};
// use std::ops::{
//     Deref,
//     DerefMut,
// };

#[derive(FromAccounts)]
pub struct Initialize<'b> {
    pub payer: Mut<Signer<AccountInfo<'b>>>,
    pub config: Mut<ConfigAccount<'b, { AccountState::Uninitialized }>>,
}

// Config account and InitializeData - only stores bridge address.
#[derive(BorshDeserialize, BorshSerialize, Default)]
pub struct InitializeData {
    pub bridge: Pubkey,
    pub conductor: Pubkey,
}

impl<'b> InstructionContext<'b> for Initialize<'b> {
}

pub fn initialize(
    ctx: &ExecutionContext,
    accs: &mut Initialize,
    data: InitializeData,
) -> Result<()> {
    //  bbrp - local only. Print bridge and conductor.
// msg!("bbrp in icco initialize {} {}", data.bridge, data.conductor);
    // Create the config account.
    accs.config.create(ctx, accs.payer.key, Exempt)?;
    accs.config.wormhole_bridge = data.bridge;
    accs.config.icco_conductor = data.conductor;
    Ok(())
}
