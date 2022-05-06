use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContributorError {
    #[error("InvalidVaaAction")]
    InvalidVaaAction,

    #[error("AllocationNotFound")]
    AllocationNotFound,

    #[error("AssetNotFound")]
    AssetNotFound,

    #[error("ContributionNotFound")]
    ContributionNotFound,

    #[error("DuplicateAcceptedToken")]
    DuplicateAcceptedToken,

    #[error("InsufficientFunds")]
    InsufficientFunds,

    #[error("NonexistentDenom")]
    NonexistentDenom,

    #[error("NonexistentToken")]
    NonexistentToken,

    #[error("NotInitialized")]
    NotInitialized,

    #[error("PendingContribute")]
    PendingContribute,

    #[error("SaleAborted")]
    SaleAborted,

    #[error("SaleAlreadyExists")]
    SaleAlreadyExists,

    #[error("SaleAlreadySealedOrAborted")]
    SaleAlreadySealedOrAborted,

    #[error("SaleEnded")]
    SaleEnded,

    #[error("SaleNotFinished")]
    SaleNotFinished,

    #[error("SaleNotFound")]
    SaleNotFound,

    #[error("SaleNotStarted")]
    SaleNotStarted,

    #[error("SaleStatusNotFound")]
    SaleStatusNotFound,

    #[error("SaleTimesNotFound")]
    SaleTimesNotFound,

    #[error("TooManyAcceptedTokens")]
    TooManyAcceptedTokens,

    #[error("ZeroAmount")]
    ZeroAmount,
}

impl ContributorError {
    pub fn std(&self) -> StdError {
        StdError::GenericErr {
            msg: format!("{}", self),
        }
    }

    pub fn std_err<T>(&self) -> Result<T, StdError> {
        Err(self.std())
    }
}
