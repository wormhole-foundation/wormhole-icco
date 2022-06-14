import { AnchorProvider, Program, web3 } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import fs from "fs";
import { AnchorContributor } from "../target/types/anchor_contributor";

export function readJson(filename: string): any {
  if (!fs.existsSync(filename)) {
    throw Error(`${filename} does not exist`);
  }
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

export function readKeypair(filename: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(Uint8Array.from(readJson(filename)));
}

export function connectToContributorProgram(
  rpc: string,
  contributorIdl: any,
  programId: web3.PublicKey,
  wallet: web3.Keypair
): Program<AnchorContributor> {
  const program = new Program<AnchorContributor>(
    contributorIdl as AnchorContributor,
    programId,
    new AnchorProvider(new web3.Connection(rpc), new NodeWallet(wallet), {})
  );
  return program;
}
