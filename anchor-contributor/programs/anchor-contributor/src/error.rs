use anchor_lang::prelude::*;

#[error_code]
pub enum ContributorError {
    #[msg("InvalidConductor")]
    InvalidConductor,
}

#[error_code]
pub enum SaleError {
    #[msg("IncorrectSale")]
    IncorrectSale,

    #[msg("IncorrectVaaPayload")]
    IncorrectVaaPayload,

    #[msg("InvalidAcceptedTokenPayload")]
    InvalidAcceptedTokenPayload,

    #[msg("InvalidAcceptedIndex")]
    InvalidAcceptedIndex,

    #[msg("InvalidTokenIndex")]
    InvalidTokenIndex,

    #[msg("InvalidVaaAction")]
    InvalidVaaAction,

    #[msg("SaleEnded")]
    SaleEnded,

    #[msg("SaleNotFinished")]
    SaleNotFinished,

    #[msg("BuyerNotActive")]
    BuyerNotActive,
}
