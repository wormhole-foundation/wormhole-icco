use crate::{
    types::{
        Address,
        ChainID,
    },
//    TokenBridgeError,
};
// use borsh::{
//     BorshDeserialize,
//     BorshSerialize,
// };
use bridge::{
    vaa::{
        DeserializePayload,
        SerializePayload,
    },
    DeserializeGovernancePayload,
    SerializeGovernancePayload,
};
use byteorder::{
    BigEndian,
    ReadBytesExt,
    WriteBytesExt,
};
use primitive_types::U256;
use solana_program::{
    // native_token::Sol,
    program_error::{
        // ProgramError,
        ProgramError::InvalidAccountData,
    },
    pubkey::Pubkey,
};
use solitaire::SolitaireError;
use std::{
    // error::Error,
    io::{
        Cursor,
        Read,
        Write,
    },
    // str::Utf8Error,
    // string::FromUtf8Error,
};

#[derive(PartialEq, Debug, Clone)]
pub struct PayloadTransfer {
    // Amount being transferred (big-endian uint256)
    pub amount: U256,
    // Address of the token. Left-zero-padded if shorter than 32 bytes
    pub token_address: Address,
    // Chain ID of the token
    pub token_chain: ChainID,
    // Address of the recipient. Left-zero-padded if shorter than 32 bytes
    pub to: Address,
    // Chain ID of the recipient
    pub to_chain: ChainID,
    // Amount of tokens (big-endian uint256) that the user is willing to pay as relayer fee. Must be <= Amount.
    pub fee: U256,
}


#[derive(PartialEq, Debug)]
pub struct PayloadGovernanceRegisterChain {
    // Chain ID of the chain to be registered
    pub chain: ChainID,
    // Address of the endpoint on the chain
    pub endpoint_address: Address,
}

impl SerializeGovernancePayload for PayloadGovernanceRegisterChain {
    const MODULE: &'static str = "TokenBridge";
    const ACTION: u8 = 1;
}

impl DeserializeGovernancePayload for PayloadGovernanceRegisterChain {
}

impl DeserializePayload for PayloadGovernanceRegisterChain
where
    Self: DeserializeGovernancePayload,
{
    fn deserialize(buf: &mut &[u8]) -> Result<Self, SolitaireError> {
        let mut v = Cursor::new(buf);
        Self::check_governance_header(&mut v)?;

        let chain = v.read_u16::<BigEndian>()?;
        let mut endpoint_address = [0u8; 32];
        v.read_exact(&mut endpoint_address)?;

        if v.position() != v.into_inner().len() as u64 {
            return Err(InvalidAccountData.into());
        }

        Ok(PayloadGovernanceRegisterChain {
            chain,
            endpoint_address,
        })
    }
}

impl SerializePayload for PayloadGovernanceRegisterChain
where
    Self: SerializeGovernancePayload,
{
    fn serialize<W: Write>(&self, writer: &mut W) -> Result<(), SolitaireError> {
        self.write_governance_header(writer)?;
        // Payload ID
        writer.write_u16::<BigEndian>(self.chain)?;
        writer.write(&self.endpoint_address[..])?;

        Ok(())
    }
}

#[derive(PartialEq, Debug)]
pub struct GovernancePayloadUpgrade {
    // Address of the new Implementation
    pub new_contract: Pubkey,
}

impl SerializePayload for GovernancePayloadUpgrade {
    fn serialize<W: Write>(&self, v: &mut W) -> std::result::Result<(), SolitaireError> {
        self.write_governance_header(v)?;
        v.write(&self.new_contract.to_bytes())?;
        Ok(())
    }
}

impl DeserializePayload for GovernancePayloadUpgrade
where
    Self: DeserializeGovernancePayload,
{
    fn deserialize(buf: &mut &[u8]) -> Result<Self, SolitaireError> {
        let mut c = Cursor::new(buf);
        Self::check_governance_header(&mut c)?;

        let mut addr = [0u8; 32];
        c.read_exact(&mut addr)?;

        if c.position() != c.into_inner().len() as u64 {
            return Err(InvalidAccountData.into());
        }

        Ok(GovernancePayloadUpgrade {
            new_contract: Pubkey::new(&addr[..]),
        })
    }
}

impl SerializeGovernancePayload for GovernancePayloadUpgrade {
    const MODULE: &'static str = "TokenBridge";
    const ACTION: u8 = 2;
}

impl DeserializeGovernancePayload for GovernancePayloadUpgrade {
}

#[cfg(feature = "no-entrypoint")]
mod tests {
    use crate::messages::{
        GovernancePayloadUpgrade,
        PayloadGovernanceRegisterChain,
        PayloadTransfer,
    };
    use bridge::{
        DeserializePayload,
        SerializePayload,
    };
    use primitive_types::U256;
    use rand::RngCore;
    use solana_program::pubkey::Pubkey;


    #[test]
    pub fn test_serde_gov_upgrade() {
        let original = GovernancePayloadUpgrade {
            new_contract: Pubkey::new_unique(),
        };

        let mut data = original.try_to_vec().unwrap();
        let deser = GovernancePayloadUpgrade::deserialize(&mut data.as_slice()).unwrap();

        assert_eq!(original, deser);
    }

    #[test]
    pub fn test_serde_gov_register_chain() {
        let mut endpoint_address = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut endpoint_address);

        let original = PayloadGovernanceRegisterChain {
            chain: 8,
            endpoint_address,
        };

        let mut data = original.try_to_vec().unwrap();
        let deser = PayloadGovernanceRegisterChain::deserialize(&mut data.as_slice()).unwrap();

        assert_eq!(original, deser);
    }
}
