use anchor_lang::prelude::*;

const SEED_PREFIX_CONTRIBUTOR_CONFIG: &[u8; 18] = b"contributor-config";

#[error_code]
pub enum ConfigError {
    #[msg("InvalidConductor")]
    InvalidConductor,
}

#[account]
pub struct ContributorConfig {
    pub conductor_chain: u16,
    pub conductor_address: [u8; 32],
    pub wormhole: Pubkey,     // 32 bytes
    pub token_bridge: Pubkey, // 32 bytes
    pub bump: u8,
}

impl ContributorConfig {
    pub const MAXIMUM_SIZE: usize = 2 + 32 + 32 + 32 + 1;

    pub fn verify_conductor(
        &self,
        conductor_chain: u16,
        conductor_address: [u8; 32],
    ) -> Result<()> {
        require!(
            conductor_chain == self.conductor_chain && conductor_address == self.conductor_address,
            ConfigError::InvalidConductor,
        );
        Ok(())
    }
}

// validation struct
#[derive(Accounts)]
pub struct CreateContributorConfig<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + ContributorConfig::MAXIMUM_SIZE,
        seeds = [SEED_PREFIX_CONTRIBUTOR_CONFIG, owner.key().as_ref()],
        bump
    )]
    pub config: Account<'info, ContributorConfig>,
    pub system_program: Program<'info, System>,
}
