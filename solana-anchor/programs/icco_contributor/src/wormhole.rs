use anchor_lang::prelude::*;

// grabbed this from https://github.com/JoeHowarth/xRaydium/blob/main/solana-proxy/programs/solana-proxy/src/wormhole.rs

pub fn parse_vaa<'info>(data: &[u8]) -> Result<WormholeMessage> {
    // first 3 bytes are b"vaa"
    let msg: WormholeMessage = AnchorDeserialize::deserialize(&mut &data[3..])?;

    Ok(msg)
}

#[derive(Debug, Default, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WormholeMessage {
    /// Header of the posted VAA
    pub vaa_version: u8,

    /// Level of consistency requested by the emitter
    pub consistency_level: u8,

    /// Time the vaa was submitted
    pub vaa_time: u32,

    /// Account where signatures are stored
    pub vaa_signature_account: Pubkey,

    /// Time the posted message was created
    pub submission_time: u32,

    /// Unique nonce for this message
    pub nonce: u32,

    /// Sequence number of this message
    pub sequence: u64,

    /// Emitter of the message
    pub emitter_chain: u16,

    /// Emitter of the message
    pub emitter_address: [u8; 32],

    /// Message payload
    pub payload: Vec<u8>,
}
