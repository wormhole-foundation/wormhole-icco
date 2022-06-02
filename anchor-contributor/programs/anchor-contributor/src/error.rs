use anchor_lang::prelude::*;

#[error_code]
pub enum ContributorError {
    #[msg("AmountTooLarge")]
    AmountTooLarge,

    #[msg("BuyerInactive")]
    BuyerInactive,

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

    #[msg("InvalidRemainingAccounts")]
    InvalidRemainingAccounts,

    #[msg("InvalidTokenDecimals")]
    InvalidTokenDecimals,

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
}
