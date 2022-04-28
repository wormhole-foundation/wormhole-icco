use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContributorError {
    #[error("InvalidVAAAction")]
    InvalidVAAAction,

    #[error("NotInitialized")]
    NotInitialized,

    #[error("SaleNotFound")]
    SaleNotFound,

    #[error("SaleAlreadyExists")]
    SaleAlreadyExists,

    #[error("SaleStatusNotFound")]
    SaleStatusNotFound,

    #[error("SaleTimesNotFound")]
    SaleTimesNotFound,

    #[error("AcceptedTokenNotFound")]
    AcceptedTokenNotFound,

    #[error("ContributionNotFound")]
    ContributionNotFound,

    #[error("AllocationNotFound")]
    AllocationNotFound,

    #[error("SaleNotFinished")]
    SaleNotFinished,

    #[error("SaleAlreadySealedOrAborted")]
    SaleAlreadySealedOrAborted,

    #[error("SaleAborted")]
    SaleAborted,

    #[error("SaleNotStarted")]
    SaleNotStarted,

    #[error("SaleEnded")]
    SaleEnded,

    #[error("WrongChain")]
    WrongChain,

    #[error("NonexistentToken")]
    NonexistentToken,

    #[error("NonexistentDenom")]
    NonexistentDenom,

    #[error("InsufficientFunds")]
    InsufficientFunds,
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
