import { registerChainOnEth, nativeToUint8Array } from "wormhole-icco-sdk";
import { ethers } from "ethers";

const fs = require("fs");
const DeploymentConfig = require("../../ethereum/icco_deployment_config.js");
const ConductorRpc = DeploymentConfig["conductor"].rpc;

const networks: string[] = ["goerli", "fuji"];

async function main() {
  for (let i = 0; i < networks.length; i++) {
    const config = DeploymentConfig[networks[i]];
    if (!config) {
      throw Error("deployment config undefined");
    }

    const testnet = JSON.parse(
      fs.readFileSync(`${__dirname}/../../testnet.json`, "utf8")
    );

    // create wallet to call sdk method with
    const provider = new ethers.providers.JsonRpcProvider(ConductorRpc);
    const wallet: ethers.Wallet = new ethers.Wallet(config.mnemonic, provider);

    // convert contributor address to bytes
    const contributorAddressBytes: Uint8Array = nativeToUint8Array(
      testnet[networks[i]],
      config.contributorChainId
    );

    // same address for eth/terra, but different for solana
    // this is used to support transfers of tokens on solana
    const custodyAddressBytes = contributorAddressBytes;

    try {
      // need to fix this to add custody account addr
      // try to perform the registration
      const tx = await registerChainOnEth(
        testnet.conductorAddress,
        config.contributorChainId,
        contributorAddressBytes,
        custodyAddressBytes,
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
