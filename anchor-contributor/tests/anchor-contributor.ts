import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import {
  tryNativeToUint8Array
} from '@certusone/wormhole-sdk';
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import fs from 'fs';

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.AnchorContributor as Program<AnchorContributor>;

  const CONDUCTOR_CHAIN = 2;
  const CONDUCTOR_ADDRESS = tryNativeToUint8Array('0x5c49f34D92316A2ac68d10A1e2168e16610e84f9', "ethereum");
  const owner = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./tests/test_keypair.json").toString())))
  const [contributor_acc, contributor_bmp] = findProgramAddressSync([
    Buffer.from("contributor"),
    CONDUCTOR_ADDRESS
  ], program.programId)

  it("creates conductor", async () => {
    await program.methods
    .createContributor(
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS)
    )
    .accounts({
      owner: owner.publicKey,
      contributor: contributor_acc,
      systemProgram: anchor.web3.SystemProgram.programId
    })
    .rpc()

    console.log(await program.account.contributor.fetch(contributor_acc));
  });

  it("initalizes a sale", async () => {
    
  })
});
