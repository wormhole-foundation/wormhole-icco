import yargs from "yargs";
import { registerChainOnEth, nativeToUint8Array } from "wormhole-icco-sdk";
import { tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

const fs = require("fs");
const DeploymentConfig = require("../../ethereum/icco_deployment_config.js");
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

  const args: string[] = parsed.network;
  return args;
}

async function main() {
  const networks = parseArgs();

  for (let i = 0; i < networks.length; i++) {
    let config;
    if (networks[i] == "solana_emitter") {
      // we're registering the solana contributor emitter address
      // but this doesn't have a key in the Deployment config
      config = DeploymentConfig["solana_testnet"];
    } else {
      config = DeploymentConfig[networks[i]];
    }
    if (!config) {
      throw Error("deployment config undefined");
    }

    const testnet = JSON.parse(
      fs.readFileSync(`${__dirname}/../../testnet.json`, "utf8")
    );

    // create wallet to call sdk method with
    const provider = new ethers.providers.JsonRpcProvider(ConductorConfig.rpc);
    const wallet: ethers.Wallet = new ethers.Wallet(
      ConductorConfig.mnemonic,
      provider
    );

    // if it's a solana registration - create 32 byte address
    let contributorAddressBytes: Uint8Array;
    if (config.contributorChainId == 1) {
      contributorAddressBytes = tryNativeToUint8Array(
        testnet[networks[i]],
        "solana"
      );
    } else {
      // convert contributor address to bytes
      contributorAddressBytes = nativeToUint8Array(
        testnet[networks[i]],
        config.contributorChainId
      );
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
      console.info(
        "Registering contributor on network:",
        networks[i],
        "txHash:",
        tx.transactionHash
      );
    } catch (error: any) {
      const errorMsg = error.toString();
      if (errorMsg.includes("chain already registered")) {
        console.info(networks[i], "has already been registered!");
      } else {
        console.log(errorMsg);
      }
    }
  }
  return;
}

main();
