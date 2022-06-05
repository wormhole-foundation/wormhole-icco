use anchor_lang::prelude::*;

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

    #[msg("IncorrectSale")]
    IncorrectSale,

    #[msg("IncorrectVaaPayload")]
    IncorrectVaaPayload,

    #[msg("InsufficientFunds")]
    InsufficientFunds,

    #[msg("InvalidAcceptedTokenPayload")]
    InvalidAcceptedTokenPayload,

    #[msg("InvalidTokensAccepted")]
    InvalidAcceptedTokens,

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

    #[msg("InvalidRemainingAccounts")]
    InvalidRemainingAccounts,

    #[msg("InvalidTokenDecimals")]
    InvalidTokenDecimals,

    #[msg("InvalidTokenIndex")]
    InvalidTokenIndex,

    #[msg("InvalidVaaAction")]
    InvalidVaaAction,

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

    #[msg("TooManyAcceptedTokens")]
    TooManyAcceptedTokens,

    #[msg("WrongAuthority")]
    WrongAuthority,
}
