import yargs from "yargs";
import { LCDClient, Wallet } from "@terra-money/terra.js";

import { WORMHOLE_ADDRESSES } from "./consts";
import {
  newClient,
  uploadContract,
  instantiateContract,
  writeContractAddress,
} from "./helpers";

async function main() {
  const args = parseArgs();
  const wormholeAddresses = WORMHOLE_ADDRESSES[args.network];

  const { terra, wallet } = newClient(args.network, args.mnemonic);
  console.log(
    `chainID: ${terra.config.chainID} wallet: ${wallet.key.accAddress}`
  );

  const contributor = await uploadAndInitIccoContributor(
    terra,
    wallet,
    wormholeAddresses.wormhole,
    wormholeAddresses.tokenBridge
  );
  console.log(`ICCO contributor: ${contributor}`);

  if (args.network === "tilt") {
    writeContractAddress(
      "../../tilt.json",
      "terraContributorAddress",
      contributor
    );
  } else if (args.network === "localterra") {
    writeContractAddress("../localterra.json", "contributor", contributor);
  }

  return 0;
}

interface Arguments {
  network: string;
  mnemonic: string;
}

function parseArgs(): Arguments {
  const parsed = yargs(process.argv.slice(2))
    .option("n", {
      alias: "network",
      choices: ["mainnet", "testnet", "localterra", "tilt"],
      string: true,
      description: "Network",
      required: true,
    })
    .option("m", {
      alias: "mnemonic",
      string: true,
      description: "Wallet Mnemonic",
    })
    .help("h")
    .alias("h", "help").argv;

  const args: Arguments = {
    // @ts-ignore
    network: parsed.network,
    // @ts-ignore
    mnemonic: parsed.mnemonic,
  };

  return args;
}

async function uploadAndInitIccoContributor(
  terra: LCDClient,
  wallet: Wallet,
  wormhole: string,
  tokenBridge: string
): Promise<string> {
  // TODO: handle existing codeId and contract addresses
  let codeId: number | undefined = undefined;
  let addr: string | undefined = undefined;

  if (codeId === undefined) {
    codeId = await uploadContract(
      terra,
      wallet,
      "../artifacts/icco_contributor.wasm"
    );
  }

  if (addr === undefined) {
    addr = await instantiateContract(
      terra,
      wallet,
      wallet.key.accAddress,
      codeId,
      {
        wormhole: wormhole,
        token_bridge: tokenBridge,
        conductor_chain: 2,
        conductor_address: "",
      }
    );
  }

  return addr;
}

main();
