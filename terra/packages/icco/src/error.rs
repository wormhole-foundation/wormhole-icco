use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CommonError {
    #[error("AmountExceedsUint128Max")]
    AmountExceedsUint128Max,

    #[error("InvalidVaaAction")]
    InvalidVaaAction,
}

impl CommonError {
    pub fn std(&self) -> StdError {
        StdError::GenericErr {
            msg: format!("{}", self),
        }
    }

    pub fn std_err<T>(&self) -> Result<T, StdError> {
        Err(self.std())
    }
}
