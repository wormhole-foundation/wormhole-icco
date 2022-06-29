use anchor_lang::prelude::*;
use const_decoder::Decoder;

use crate::{
    constants::INDEX_SALE_ID,
    env::*,
    error::ContributorError,
    wormhole::{get_message_data, MessageData},
};

use std::str::FromStr;

#[account]
#[derive(Default)]
pub struct Custodian {
    pub nonce: u32, // 4
    pub seed_bump: u8,
    pub wormhole_pubkey: Pubkey,
    pub token_bridge_pubkey: Pubkey,

    pub custody_signer_key: Pubkey,     // 32
    pub mint_signer_key: Pubkey,     // 32
    pub authority_signer_key: Pubkey,     // 32
    pub bridge_config_key: Pubkey,     // 32
    pub wormhole_config_key: Pubkey,     // 32
    pub fee_collector_key: Pubkey,     // 32
    pub wormhole_emitter_key: Pubkey,     // 32
    pub wormhole_sequence_key: Pubkey,     // 32
}


impl Custodian {
    pub const MAXIMUM_SIZE: usize = 4 + 1 + 32 + 32
    + 32         // custody_signer key+bump
    + 32         // mint_signer key+bump
    + 32         // authority_signer key+bump
    + 32         // bridge_config key+bump
    + 32         // wormhole_config key+bump
    + 32         // fee_collector key+bump
    + 32         // wormhole_emitter key+bump
    + 32         // wormhole_sequence key+bump
    + 0;         // In case...

    const CONDUCTOR_ADDRESS_BYTES: [u8; 32] = Decoder::Hex.decode(CONDUCTOR_ADDRESS.as_bytes());

    pub fn conductor_chain() -> Result<u16> {
        let chain_id = CONDUCTOR_CHAIN
            .to_string()
            .parse()
            .map_err(|_| ContributorError::InvalidConductorChain)?;
        Ok(chain_id)
    }

    pub fn conductor_address () -> &'static [u8; 32] {
        &Custodian::CONDUCTOR_ADDRESS_BYTES
    }

    pub fn wormhole_check() -> Result<Pubkey> {
        let pubkey = Pubkey::from_str(CORE_BRIDGE_ADDRESS)
            .map_err(|_| ContributorError::InvalidWormholeAddress)?;
        Ok(pubkey)
    }

    pub fn wormhole(&self) -> &Pubkey {
        &self.wormhole_pubkey
    }


    pub fn token_bridge_check() -> Result<Pubkey> {
        let pubkey = Pubkey::from_str(TOKEN_BRIDGE_ADDRESS)
            .map_err(|_| ContributorError::InvalidWormholeAddress)?;
        Ok(pubkey)
    }

    pub fn token_bridge(&self) -> &Pubkey {
        &self.token_bridge_pubkey
    }


    pub fn new(&mut self) -> Result<()> {
        self.nonce = 0;
        Ok(())
    }

    pub fn parse_and_verify_conductor_vaa<'info>(
        &self,
        vaa_acct: &AccountInfo<'info>,
        payload_type: u8,
    ) -> Result<MessageData> {
        let msg = get_message_data(&vaa_acct)?;
        require!(
            msg.emitter_chain == Custodian::conductor_chain()?,
            ContributorError::InvalidConductorChain
        );
        require!(
            msg.emitter_address == *Custodian::conductor_address(),
            ContributorError::InvalidConductorAddress
        );
        require!(
            msg.payload[0] == payload_type,
            ContributorError::InvalidVaaAction
        );
        Ok(msg)
    }

    pub fn get_sale_id_from_payload(payload: &[u8]) -> [u8; 32] {
        let mut sale_id = [0u8; 32];
        sale_id.copy_from_slice(&payload[INDEX_SALE_ID..INDEX_SALE_ID + 32]);
        sale_id
    }

    pub fn get_sale_id_from_vaa<'info>(vaa_acct: &AccountInfo<'info>) -> Result<[u8; 32]> {
        let msg = get_message_data(&vaa_acct)?;
        Ok(Custodian::get_sale_id_from_payload(&msg.payload))
    }

    pub fn parse_and_verify_conductor_vaa_and_sale<'info>(
        &self,
        vaa_acct: &AccountInfo<'info>,
        payload_type: u8,
        sale_id: [u8; 32],
    ) -> Result<MessageData> {
        let msg = self.parse_and_verify_conductor_vaa(vaa_acct, payload_type)?;
        require!(
            Custodian::get_sale_id_from_payload(&msg.payload) == sale_id,
            ContributorError::InvalidSale,
        );
        Ok(msg)
    }
}
