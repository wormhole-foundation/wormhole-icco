use anchor_lang::prelude::*;

#[error_code]
pub enum SaleError {
    #[msg("ContributionTooEarly")]
    ContributionTooEarly,

    #[msg("IncorrectSale")]
    IncorrectSale,

    #[msg("IncorrectVaaPayload")]
    IncorrectVaaPayload,

    #[msg("InvalidAcceptedTokenPayload")]
    InvalidAcceptedTokenPayload,

    #[msg("InvalidConductor")]
    InvalidConductor,

    #[msg("InvalidTokenIndex")]
    InvalidTokenIndex,

    #[msg("InvalidVaaAction")]
    InvalidVaaAction,

    #[msg("InvalidTokensAccepted")]
    InvalidAcceptedTokens,

    #[msg("SaleAlreadyInitialized")]
    SaleAlreadyInitialized,

    #[msg("SaleEnded")]
    SaleEnded,

    #[msg("SaleNotFinished")]
    SaleNotFinished,

    #[msg("SaleNotAborted")]
    SaleNotAborted,

    #[msg("SaleNotSealed")]
    SaleNotSealed,

    #[msg("TooManyAcceptedTokens")]
    TooManyAcceptedTokens,
}

#[error_code]
pub enum BuyerError {
    #[msg("BuyerInactive")]
    BuyerInactive,

    #[msg("InvalidTokenIndex")]
    InvalidTokenIndex,
}
