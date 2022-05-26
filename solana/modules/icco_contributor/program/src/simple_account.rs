use solana_program::{
    pubkey::Pubkey,
    system_instruction,
    //account_info::AccountInfo,
    program::invoke,
    program::invoke_signed,
    // program_error::ProgramError,
    // pubkey::Pubkey,
    sysvar::rent::Rent,
};

use solitaire::*;

pub fn create_simple_account (
    ctx: &ExecutionContext,
    pubkey: &Pubkey,
    payer: &Pubkey,
    size: usize,
    vseeds: &Vec<Vec<u8>>
) -> Result<()> {
    let target_rent =  Rent::default().minimum_balance(size);
    // top up account to target rent
    let transfer_ix = system_instruction::transfer(payer, pubkey, target_rent);
    invoke(&transfer_ix, ctx.accounts)?;
    // msg!("transferred {} lamports", target_rent);

    // invoke is just a synonym for invoke_signed with an empty list
    // Temp vars are needed to hold values.
    let mut tmp_v_seeds: Vec<&[u8]> = vseeds.iter().map(|x| &x[..]).collect();
    let (_, bump_seed) = Pubkey::find_program_address(&tmp_v_seeds[..], ctx.program_id);
    let bsr = [&[bump_seed][..]];
    tmp_v_seeds.extend(bsr);
    let sig_seeds = &[&tmp_v_seeds[..]][..];

    // allocate space
    let allocate_ix = system_instruction::allocate(pubkey, size as u64);
    invoke_signed(&allocate_ix, ctx.accounts, sig_seeds)?;

    // assign ownership
    let assign_ix = system_instruction::assign(pubkey, ctx.program_id);
    invoke_signed(&assign_ix, ctx.accounts, sig_seeds)?;
    Ok(())
}
