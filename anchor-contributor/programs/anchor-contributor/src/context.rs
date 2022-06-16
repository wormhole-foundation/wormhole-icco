use anchor_lang::{
    prelude::*,
    solana_program::sysvar::{clock, rent},
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    state::{Buyer, Custodian, Sale},
};

/// Context allows contract owner to create an account that acts
/// to hold all associated token accounts for all sales.
/// See `create_custodian` instruction in lib.rs.
///
/// Mutable
/// * `custodian`
/// * `payer` (signer)
#[derive(Accounts)]
pub struct CreateCustodian<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            SEED_PREFIX_CUSTODIAN.as_bytes(),
        ],
        bump,
        space = 8 + Custodian::MAXIMUM_SIZE,
    )]
    pub custodian: Account<'info, Custodian>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Context provides all accounts required for someone to initialize a sale
/// with a signed VAA sent by the conductor. A `Sale` is created at this step,
/// which will be used for future actions.
/// See `init_sale` instruction in lib.rs.
///
/// /// Immutable
/// * `custodian`
/// * `core_bridge_vaa`
/// * `sale_token_mint`
/// * `custodian_sale_token_acct`
///
/// Mutable
/// * `sale`
/// * `payer` (signer)
#[derive(Accounts)]
pub struct InitSale<'info> {
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
        payer = payer,
        bump,
        space = 8 + Sale::MAXIMUM_SIZE
    )]
    pub sale: Account<'info, Sale>,

    #[account(
        constraint = core_bridge_vaa.owner.key() ==  Custodian::wormhole()?
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,
    pub sale_token_mint: Account<'info, Mint>,

    #[account(
        associated_token::mint = sale_token_mint,
        associated_token::authority = custodian,
    )]
    /// This must be an associated token account
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context provides all accounts required for user to send contribution
/// to ongoing sale.
/// See `contribute` instruction in lib.rs.
///
/// Immutable
/// * `custodian`
///
/// Mutable
/// * `sale`
/// * `buyer`
/// * `buyer_token_acct`
/// * `custodian_token_acct`
/// * `owner` (signer)
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
        associated_token::mint = buyer_token_acct.mint,
        associated_token::authority = custodian,
    )]
    /// This must be an associated token account
    pub custodian_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context provides all accounts required to attest contributions.
/// See `attest_contributions` instruction in lib.rs.
///
/// Immutable
/// * `sale`
/// * `core_bridge`
/// * `clock`
/// * `rent`
///
/// Mutable
/// * `wormhole_config`
/// * `wormhole_fee_collector`
/// * `wormhole_emitter`
/// * `wormhole_sequence`
/// * `wormhole_message`
/// * `payer` (signer)
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

    #[account(
        constraint = wormhole.key() == Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Program
    pub wormhole: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"Bridge".as_ref()
        ],
        bump,
        seeds::program =  Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Config
    pub wormhole_config: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"fee_collector".as_ref()
        ],
        bump,
        seeds::program = Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Fee Collector
    pub wormhole_fee_collector: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"emitter".as_ref(),
        ],
        bump
    )]
    /// CHECK: Wormhole Emitter is this program
    pub wormhole_emitter: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"Sequence".as_ref(),
            wormhole_emitter.key().as_ref()
        ],
        bump,
        seeds::program = Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Sequence Number
    pub wormhole_sequence: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"attest-contributions".as_ref(),
            &sale.id,
        ],
        bump,
    )]
    /// CHECK: Wormhole Message Storage
    pub wormhole_message: AccountInfo<'info>,

    #[account(
        constraint = clock.key() == clock::id()
    )]
    /// CHECK: Clock
    pub clock: AccountInfo<'info>,

    #[account(
        constraint = rent.key() == rent::id()
    )]
    /// CHECK: Rent
    pub rent: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Context provides all accounts required to bridge tokens to recipient.
/// See `bridge_sealed_contribution` instruction in lib.rs.
///
/// Immutable
/// * `custodian`
/// * `wormhole`
/// * `token_bridge`
/// * `custody_signer`
/// * `token_mint_signer`
/// * `token_bridge_config`
/// * `clock`
/// * `rent`
///
/// Mutable
/// * `sale`
/// * `custodian_token_acct`
/// * `accepted_mint`
/// * `custody_or_wrapped_meta`
/// * `authority_signer`
/// * `wormhole_config`
/// * `wormhole_fee_collector`
/// * `wormhole_emitter`
/// * `wormhole_sequence`
/// * `wormhole_message`
/// * `payer` (signer)
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

    /// CHECK: Check if owned by ATA Program
    #[account(
        mut,
        associated_token::mint = accepted_mint,
        associated_token::authority = custodian,
    )]
    /// This must be an associated token account
    pub custodian_token_acct: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    /// CHECK: Check if owned by SPL Account. Token Bridge needs this to be mutable
    pub accepted_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    #[account(
        constraint = token_bridge.key() == Custodian::token_bridge()?
    )]
    /// CHECK: Token Bridge Program
    pub token_bridge: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Will either be token bridge custody account or wrapped meta account
    pub custody_or_wrapped_meta: AccountInfo<'info>,

    #[account(
        seeds=[b"custody_signer"],
        bump,
        seeds::program = token_bridge.key()
    )]
    /// CHECK: Only used for bridging assets native to Solana.
    pub custody_signer: AccountInfo<'info>,

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
    /// CHECK: Token Bridge Authority Signer, delegated approval for transfer
    pub authority_signer: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"config".as_ref()
        ],
        bump,
        seeds::program = Custodian::token_bridge()?
    )]
    /// CHECK: Token Bridge Config
    pub token_bridge_config: AccountInfo<'info>,

    #[account(
        constraint = wormhole.key() == Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Program
    pub wormhole: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"Bridge".as_ref()
        ],
        bump,
        seeds::program = Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Config
    pub wormhole_config: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"fee_collector".as_ref()
        ],
        bump,
        seeds::program = Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Fee Collector
    pub wormhole_fee_collector: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"emitter".as_ref(),
        ],
        bump,
        seeds::program = Custodian::token_bridge()?
    )]
    /// CHECK: Wormhole Emitter is the Token Bridge Program
    pub wormhole_emitter: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"Sequence".as_ref(),
            wormhole_emitter.key().as_ref()
        ],
        bump,
        seeds::program = Custodian::wormhole()?
    )]
    /// CHECK: Wormhole Sequence Number
    pub wormhole_sequence: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            b"bridge-sealed".as_ref(),
            &sale.id,
            &accepted_mint.key().as_ref(),
        ],
        bump,
    )]
    /// CHECK: Wormhole Message Storage
    pub wormhole_message: AccountInfo<'info>,

    #[account(
        constraint = clock.key() == clock::id()
    )]
    /// CHECK: Clock
    pub clock: AccountInfo<'info>,

    #[account(
        constraint = rent.key() == rent::id()
    )]
    /// CHECK: Rent
    pub rent: AccountInfo<'info>,
}

/// Context provides all accounts required for someone to abort a sale
/// with a signed VAA sent by the conductor (sale didn't meet min raise).
/// See `abort_sale` instruction in lib.rs.
///
/// Immutable
/// * `custodian`
/// * `core_bridge_vaa`
///
/// Mutable
/// * `sale`
/// * `owner` (signer)
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
        constraint = core_bridge_vaa.owner.key() == Custodian::wormhole()?
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Context provides all accounts required for someone to seal a sale
/// with a signed VAA sent by the conductor (sale met at least min raise).
/// See `seal_sale` instruction in lib.rs.
///
/// Immutable
/// * `custodian`
/// * `core_bridge_vaa`
/// * `custodian_sale_token_acct`
///
/// Mutable
/// * `sale`
/// * `owner` (signer)
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
        constraint = core_bridge_vaa.owner.key() == Custodian::wormhole()?
    )]
    /// CHECK: This account is owned by Core Bridge so we trust it
    pub core_bridge_vaa: AccountInfo<'info>,

    #[account(
        associated_token::mint = sale.sale_token_mint,
        associated_token::authority = custodian,
    )]
    /// This must be an associated token account
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context provides all accounts required for user to claim his allocation
/// and excess contributions after the sale has been sealed.
/// See `claim_allocation` instruction in lib.rs.
///
/// Immutable
/// * `custodian`
/// * `sale`
///
/// Mutable
/// * `buyer`
/// * `custodian_sale_token_acct`
/// * `buyer_sale_token_acct`
/// * `owner` (signer)
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
        associated_token::mint = sale.sale_token_mint,
        associated_token::authority = custodian,
    )]
    /// This must be an associated token account
    pub custodian_sale_token_acct: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = buyer_sale_token_acct.mint == sale.sale_token_mint,
        constraint = buyer_sale_token_acct.owner == owner.key(),
    )]
    pub buyer_sale_token_acct: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context provides all accounts required for user to claim his refunds
/// after the sale has been aborted.
/// See `claim_refunds` instruction in lib.rs.
///
/// /// Immutable
/// * `custodian`
/// * `sale`
///
/// Mutable
/// * `buyer`
/// * `owner` (signer)
///
/// NOTE: With `claim_refunds`, remaining accounts are passed in
/// depending on however many accepted tokens there are for a given sale.
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

/// Context provides all accounts required for user to claim any excess
/// contributions after the sale has been sealed. See `claim_excesses`
/// instruction in lib.rs.
///
/// /// Immutable
/// * `custodian`
/// * `sale`
///
/// Mutable
/// * `buyer`
/// * `owner` (signer)
///
/// NOTE: With `claim_excesses`, remaining accounts are passed in
/// depending on however many accepted tokens there are for a given sale.
#[derive(Accounts)]
pub struct ClaimExcesses<'info> {
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
