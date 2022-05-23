use anchor_lang::prelude::*;

#[error_code]
pub enum ContributorError {
    #[msg("InvalidConductor")]
    InvalidConductor,
}

#[account]
pub struct Contributor {
    pub conductor_chain: u16,
    pub conductor_address: [u8; 32],
    pub wormhole: Pubkey,     // 32 bytes
    pub token_bridge: Pubkey, // 32 bytes
    pub bump: u8,
}

impl Contributor {
    pub const MAXIMUM_SIZE: usize = 2 + 32 + 32 + 32 + 1;

    pub fn verify_conductor(
        &self,
        conductor_chain: u16,
        conductor_address: [u8; 32],
    ) -> Result<()> {
        require!(
            conductor_chain == self.conductor_chain && conductor_address == self.conductor_address,
            ContributorError::InvalidConductor,
        );
        Ok(())
    }
}

// validation struct
#[derive(Accounts)]
pub struct CreateContributor<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Contributor::MAXIMUM_SIZE,
    )]
    pub config: Account<'info, Contributor>,
    pub system_program: Program<'info, System>,
}
