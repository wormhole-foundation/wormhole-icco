use bridge::{
    vaa::{
        PayloadMessage,
        DeserializePayload,
    },   
};

use solitaire::{
    trace,
    *,
};
use std::{
    ops::Deref,
};

#[derive(FromAccounts)]
pub struct ClaimedVAA<'b, T: DeserializePayload> {
    // Signed message for the transfer
    pub message: PayloadMessage<'b, T>,
}

impl<'b, T: DeserializePayload> Deref for ClaimedVAA<'b, T> {
    type Target = PayloadMessage<'b, T>;
    fn deref(&self) -> &Self::Target {
        &self.message
    }
}
