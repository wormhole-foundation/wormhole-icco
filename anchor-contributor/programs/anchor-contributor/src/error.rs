use anchor_lang::prelude::error_code;

#[error_code]
pub enum ContributorError {
    #[msg("AlreadyClaimed")]
    AlreadyClaimed,

    #[msg("AmountTooLarge")]
    AmountTooLarge,

    #[msg("BuyerInactive")]
    BuyerInactive,

    #[msg("ContributeDeactivated")]
    ContributeDeactivated,

    #[msg("ContributionTooEarly")]
    ContributionTooEarly,

    #[msg("EcdsaRecoverFailure")]
    EcdsaRecoverFailure,

    #[msg("InsufficientFunds")]
    InsufficientFunds,

    #[msg("InvalidAcceptedTokenPayload")]
    InvalidAcceptedTokenPayload,

    #[msg("InvalidAcceptedToken")]
    InvalidAcceptedToken,

    #[msg("InvalidAccount")]
    InvalidAccount,

    #[msg("InvalidConductorChain")]
    InvalidConductorChain,

    #[msg("InvalidConductorAddress")]
    InvalidConductorAddress,

    #[msg("InvalidKycAuthority")]
    InvalidKycAuthority,

    #[msg("InvalidKycSignature")]
    InvalidKycSignature,

    #[msg("InvalidSale")]
    InvalidSale,

    #[msg("InvalidRemainingAccounts")]
    InvalidRemainingAccounts,

    #[msg("InvalidTokenBridgeAddress")]
    InvalidTokenBridgeAddress,

    #[msg("InvalidTokenDecimals")]
    InvalidTokenDecimals,

    #[msg("InvalidTokenIndex")]
    InvalidTokenIndex,

    #[msg("InvalidVaaAction")]
    InvalidVaaAction,

    #[msg("InvalidWormholeAddress")]
    InvalidWormholeAddress,

    #[msg("InvalidVaaPayload")]
    InvalidVaaPayload,

    #[msg("NothingToClaim")]
    NothingToClaim,

    #[msg("SaleAlreadyInitialized")]
    SaleAlreadyInitialized,

    #[msg("SaleEnded")]
    SaleEnded,

    #[msg("SaleNotAborted")]
    SaleNotAborted,

    #[msg("SaleNotAttestable")]
    SaleNotAttestable,

    #[msg("SaleNotFinished")]
    SaleNotFinished,

    #[msg("SaleNotSealed")]
    SaleNotSealed,

    #[msg("SaleTokenNotAttested")]
    SaleTokenNotAttested,

    #[msg("TooManyAcceptedTokens")]
    TooManyAcceptedTokens,

    #[msg("TransferNotAllowed")]
    TransferNotAllowed,

    #[msg("AllocationsLocked")]
    AllocationsLocked,

    #[msg("SaleContributionsAreBlocked")]
    SaleContributionsAreBlocked,

    #[msg("AssetContributionsAreBlocked")]
    AssetContributionsAreBlocked,

    #[msg("InvalidAcceptedTokenATA")]
    InvalidAcceptedTokenATA,

    #[msg("InvalidWormholeMessageAccount")]
    InvalidWormholeMessageAccount,

    #[msg("InvalidTokenBridgeProgram")]
    InvalidTokenBridgeProgram,

    #[msg("InvalidWormholeProgram")]
    InvalidWormholeProgram,

    #[msg("InvalidSystemProgram")]
    InvalidSystemProgram,

    #[msg("InvalidSaleTokenATA")]
    InvalidSaleTokenATA,
}
