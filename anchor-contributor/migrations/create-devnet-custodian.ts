import { postVaaSolanaWithRetry } from "@certusone/wormhole-sdk";
import { web3 } from "@project-serum/anchor";
import { IccoContributor } from "../tests/helpers/contributor";
import { connectToContributorProgram, readJson, readKeypair } from "./utils";

const CORE_BRIDGE_ADDRESS = new web3.PublicKey(process.env.CORE_BRIDGE_ADDRESS);
const TOKEN_BRIDGE_ADDRESS = new web3.PublicKey(process.env.TOKEN_BRIDGE_ADDRESS);

async function main() {
  const rpc = "https://api.devnet.solana.com";
  const contributorIdl = readJson(`${__dirname}/../target/idl/anchor_contributor.json`);

  const programId = readKeypair(`${__dirname}/../target/deploy/anchor_contributor-keypair.json`).publicKey;
  const payer = readKeypair(process.env.WALLET);

  console.log("wormhole", CORE_BRIDGE_ADDRESS.toString());
  console.log("token bridge", TOKEN_BRIDGE_ADDRESS.toString());
  console.log("program id", programId.toString());
  console.log("payer", payer.publicKey.toString());

  const program = connectToContributorProgram(rpc, contributorIdl, programId, payer);

  const contributor = new IccoContributor(program, CORE_BRIDGE_ADDRESS, TOKEN_BRIDGE_ADDRESS, postVaaSolanaWithRetry);

  try {
    const tx = await contributor.createCustodian(payer);
    console.log("tx", tx);
  } catch (e) {
    console.log("custodian already created");
  }

  const custodian = contributor.deriveCustodianAccount();
  console.log("custodian", custodian.toString());
}

main();
