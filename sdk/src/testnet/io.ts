import { web3 } from "@project-serum/anchor";
import fs from "fs";

export function readJson(filename: string): any {
  if (!fs.existsSync(filename)) {
    throw Error(`${filename} does not exist`);
  }
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

export function readKeypair(filename: string): web3.Keypair {
  return web3.Keypair.fromSecretKey(Uint8Array.from(readJson(filename)));
}
