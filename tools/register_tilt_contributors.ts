import fs from "fs";

import {
  ChainId,
  CHAIN_ID_SOLANA,
  CHAIN_ID_ETH,
  CHAIN_ID_BSC,
  hexToUint8Array,
} from "@certusone/wormhole-sdk";
import {
  getContributorContractOnEth,
  registerChainOnEth,
} from "wormhole-icco-sdk";
import { ethers } from "ethers";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ETH_DEVNET_PK =
  "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d"; // account 2

interface Emitter {
  chainId: ChainId;
  address: string;
}

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    "http://localhost:8545"
  );
  const wallet = new ethers.Wallet(ETH_DEVNET_PK, provider);

  const tilt = JSON.parse(
    fs.readFileSync(`${__dirname}/../../tilt.json`, "utf8")
  );

  const emitters: Emitter[] = [];
  {
    // TODO: grab this from the tilt.json file...
    // const solanaProgAddr = "22mamxmojFWBdbGqaxTH46HBAgAY2bJRiGJJHfNRNQ95";  //TBD Not used, because I could not get WH sdk to be available in tilt.
    const solanaEmitterAddr =
      "aeab35a8d36bbaad38154ca4ca6a0770e7009326316d59ef2c8a2123e90d174c"; // Derived from solanaProgAddr using await sdk.getEmitterAddressSolana(..);

    // Build chainId -> ContributorAddr map.
    const ethEmitterAddress =
      "000000000000000000000000" + tilt.ethContributorAddress.substring(2);
    const bscEmitterAddress =
      "000000000000000000000000" + tilt.bscContributorAddress.substring(2);
    emitters.push({ chainId: CHAIN_ID_SOLANA, address: solanaEmitterAddr });
    emitters.push({ chainId: CHAIN_ID_ETH, address: ethEmitterAddress });
    emitters.push({ chainId: CHAIN_ID_BSC, address: bscEmitterAddress });
  }

  // register all chainId -> ContributorAddr with conductor.
  for (const emitter of emitters) {
    console.log(
      "Registering chainId: ",
      emitter.chainId,
      " emitter: ",
      emitter.address
    );

    const contributorAddress = hexToUint8Array(emitter.address);
    const receipt = await registerChainOnEth(
      tilt.conductorAddress,
      emitter.chainId,
      contributorAddress,
      wallet
    );

    const check = await getContributorContractOnEth(
      tilt.conductorAddress,
      provider,
      emitter.chainId
    );
  }

  return;
}

main();
