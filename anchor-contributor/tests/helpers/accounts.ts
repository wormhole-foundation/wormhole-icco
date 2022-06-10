import { web3 } from "@project-serum/anchor";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";

import { hashVaaPayload } from "./wormhole";

export type KeyBump = {
  key: web3.PublicKey;
  bump: number;
};

export function findKeyBump(seeds: (Buffer | Uint8Array)[], program: web3.PublicKey): KeyBump {
  const [key, bump] = findProgramAddressSync(seeds, program);
  return {
    key,
    bump,
  };
}

export function findCustodianAccount(programId: web3.PublicKey): KeyBump {
  return findKeyBump([Buffer.from("icco-custodian")], programId);
}

export function findSignedVaaAccount(wormhole: web3.PublicKey, signedVaa: Buffer): KeyBump {
  const hash = hashVaaPayload(signedVaa);
  return findKeyBump([Buffer.from("PostedVAA"), hash], wormhole);
}

export function findSaleAccount(programId: web3.PublicKey, saleId: Buffer): KeyBump {
  return findKeyBump([Buffer.from("icco-sale"), saleId], programId);
}

export function findBuyerAccount(programId: web3.PublicKey, saleId: Buffer, buyer: web3.PublicKey): KeyBump {
  return findKeyBump([Buffer.from("icco-buyer"), saleId, buyer.toBuffer()], programId);
}

export function findAttestContributionsMsgAccount(programId: web3.PublicKey, saleId: Buffer): KeyBump {
  return findKeyBump([Buffer.from("attest-contributions"), saleId], programId);
}
