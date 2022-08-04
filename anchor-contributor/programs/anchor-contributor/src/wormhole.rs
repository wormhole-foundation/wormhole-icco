use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use std::io::Write;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct PostMessageData {
    /// Unique nonce for this message
    pub nonce: u32,

    /// Message payload
    pub payload: Vec<u8>,

    /// Commitment Level required for an attestation to be produced
    pub consistency_level: ConsistencyLevel,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum ConsistencyLevel {
    Confirmed,
    Finalized,
}

#[derive(AnchorDeserialize, AnchorSerialize)]
pub enum Instruction {
    Initialize,
    PostMessage,
    PostVAA,
    SetFees,
    TransferFees,
    UpgradeContract,
    UpgradeGuardianSet,
    VerifySignatures,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct BridgeData {
    /// The current guardian set index, used to decide which signature sets to accept.
    pub guardian_set_index: u32,

    /// Lamports in the collection account
    pub last_lamports: u64,

    /// Bridge configuration, which is set once upon initialization.
    pub config: BridgeConfig,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct BridgeConfig {
    /// Period for how long a guardian set is valid after it has been replaced by a new one.  This
    /// guarantees that VAAs issued by that set can still be submitted for a certain period.  In
    /// this period we still trust the old guardian set.
    pub guardian_set_expiration_time: u32,

    /// Amount of lamports that needs to be paid to the protocol to post a message
    pub fee: u64,
}

#[derive(Debug)]
#[repr(transparent)]
pub struct PostedMessageData(pub MessageData);

#[derive(Debug)]
#[repr(transparent)]
pub struct PostedVAAData(pub MessageData);

#[derive(Debug, Default, BorshDeserialize, BorshSerialize)]
pub struct MessageData {
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

impl AnchorSerialize for PostedMessageData {
    fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
        writer.write(b"msg")?;
        BorshSerialize::serialize(&self.0, writer)
    }
}

impl AnchorDeserialize for PostedVAAData {
    fn deserialize(buf: &mut &[u8]) -> std::io::Result<Self> {
        if buf.len() < 3 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Invalid VAA Message",
            ));
        }

        // We accept "vaa", "msg", or "msu" because it's convenient to read all of these as PostedVAAData
        let expected: [&[u8]; 3] = [b"vaa", b"msg", b"msu"];
        let magic: &[u8] = &buf[0..3];
        if !expected.contains(&magic) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Invalid VAA Message",
            ));
        };
        *buf = &buf[3..];
        Ok(PostedVAAData(
            <MessageData as BorshDeserialize>::deserialize(buf)?,
        ))
    }
}

pub fn get_message_data<'info>(vaa_account: &AccountInfo<'info>) -> Result<MessageData> {
    Ok(PostedVAAData::try_from_slice(&vaa_account.data.borrow())?.0)
}
