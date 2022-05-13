use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContributorError {
    #[error("AllocationNotFound")]
    AllocationNotFound,

    #[error("AssetNotFound")]
    AssetNotFound,

    #[error("BuyerNotActive")]
    BuyerNotActive,

    #[error("ContributionNotFound")]
    ContributionNotFound,

    #[error("DuplicateAcceptedToken")]
    DuplicateAcceptedToken,

    #[error("FeeTokensForbidden")]
    FeeTokensForbidden,

    #[error("IncorrectFunds")]
    IncorrectFunds,

    #[error("InsufficientSaleTokens")]
    InsufficientSaleTokens,

    #[error("NonexistentBuyer")]
    NonexistentBuyer,

    #[error("NonexistentDenom")]
    NonexistentDenom,

    #[error("NonexistentToken")]
    NonexistentToken,

    #[error("PendingContribute")]
    PendingContribute,

    #[error("SaleAborted")]
    SaleAborted,

    #[error("SaleAlreadyExists")]
    SaleAlreadyExists,

    #[error("SaleEnded")]
    SaleEnded,

    #[error("SaleNonexistent")]
    SaleNonexistent,

    #[error("SaleNotFinished")]
    SaleNotFinished,

    #[error("SaleNotStarted")]
    SaleNotStarted,

    #[error("SaleStillActive")]
    SaleStillActive,

    #[error("TooManyAcceptedTokens")]
    TooManyAcceptedTokens,

    #[error("UnsupportedConductor")]
    UnsupportedConductor,

    #[error("WrongBuyerStatus")]
    WrongBuyerStatus,

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
