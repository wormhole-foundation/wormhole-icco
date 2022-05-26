//! Define application level errors that can be returned by the various instruction handlers that
//! make up the wormhole bridge.

use crate::trace;
use solitaire::SolitaireError;

#[derive(Debug)]
pub enum Error {
    VAAAlreadyExecuted,
    VAAInvalidPayloadId,
    VAAInvalidEmitterChain,
    VAAInvalidEmitterAddress,
    VAAInvalid,
    InvalidTokenAddress,
    InvalidTokenIndex,
    SaleSealedOrAborted,
    SaleHasNotStarted,
    SaleIsNotAborted,
    SaleHasEnded,
    SaleHasBeenSealed,
    SaleHasNotBeenSealed,
    SaleHasBeenAborted,
    VAATokenCountExceeded,
    SaleStateAccountAddressIncorrect,
    SaleStateIsAlredyInitialized,
    SaleTokenAccountAddressIncorrect,
    SaleTokenCustodyAccountEmpty,
    TestAccountError,
    NotEnoughTokensInCustody,
    PayerLapmortsOverflow,
}

/// Errors thrown by the program will bubble up to the solitaire wrapper, which needs a way to
/// translate these errors into something Solitaire can log and handle.
impl From<Error> for SolitaireError {
    fn from(e: Error) -> SolitaireError {
        trace!("ProgramError: {:?}", e);
        SolitaireError::Custom(e as u64)
    }
}
