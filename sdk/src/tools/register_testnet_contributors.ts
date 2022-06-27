import yargs from "yargs";
import { registerChainOnEth } from "../icco/registerChain";
import { tryNativeToUint8Array, tryUint8ArrayToNative } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { web3 } from "@project-serum/anchor";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";

const fs = require("fs");
const DeploymentConfig = require("../../../ethereum/icco_deployment_config.json");
const ConductorConfig = DeploymentConfig["conductor"];

function parseArgs(): string[] {
  const parsed = yargs(process.argv.slice(2))
    .option("network", {
      type: "array",
      description: "Name of network to register (e.g. goerli)",
      required: true,
    })
    .help("h")
    .alias("h", "help").argv;

  // @ts-ignore
  const args: string[] = parsed.network;
  return args;
}

async function main() {
  const networks = parseArgs();

  for (const network of networks) {
    const config = DeploymentConfig[network];
    if (!config) {
      throw Error("deployment config undefined");
    }

    const testnet = JSON.parse(fs.readFileSync(`${__dirname}/../../../testnet.json`, "utf8"));

    // create wallet to call sdk method with
    const provider = new ethers.providers.JsonRpcProvider(ConductorConfig.rpc);
    const wallet: ethers.Wallet = new ethers.Wallet(ConductorConfig.mnemonic, provider);

    // if it's a solana registration - create 32 byte address
    let contributorAddressBytes: Uint8Array;
    if (config.contributorChainId == 1) {
      contributorAddressBytes = tryNativeToUint8Array(testnet[network], "solana");
      const programId = new web3.PublicKey(contributorAddressBytes);
      const [key, _] = findProgramAddressSync([Buffer.from("emitter")], programId);
      contributorAddressBytes = tryNativeToUint8Array(key.toString(), "solana");
    } else {
      // convert contributor address to bytes
      contributorAddressBytes = tryNativeToUint8Array(testnet[network], config.contributorChainId);
    }

    try {
      // need to fix this to add custody account addr
      // try to perform the registration
      const tx = await registerChainOnEth(
        testnet.conductorAddress,
        config.contributorChainId,
        contributorAddressBytes,
        wallet
      );

      // output hash
      console.info("Registering contributor on network:", network, "txHash:", tx.transactionHash);
    } catch (error: any) {
      const errorMsg = error.toString();
      if (errorMsg.includes("chain already registered")) {
        console.info(network, "has already been registered!");
      } else {
        console.log(errorMsg);
      }
    }
  }
  return;
}

main();
