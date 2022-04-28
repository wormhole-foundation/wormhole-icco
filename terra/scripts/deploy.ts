import "dotenv/config";
import yargs from "yargs";
import {
  newClient,
  uploadContract,
  instantiateContract,
  writeContractAddress,
} from "./helpers.js";
import { LCDClient } from "@terra-money/terra.js";

const WORMHOLE_ADDRESSES: any = {
  mainnet: {
    wormhole: "terra1dq03ugtd40zu9hcgdzrsq6z2z4hwhc9tqk2uy5",
    tokenBridge: "terra10nmmwe8r3g99a9newtqa7a75xfgs2e8z87r2sf",
  },
  testnet: {
    wormhole: "terra1pd65m0q9tl3v8znnz5f5ltsfegyzah7g42cx5v",
    tokenBridge: "terra1pseddrv0yfsn76u4zxrjmtf45kdlmalswdv39a",
  },
  localterra: {
    wormhole: "terra18vd8fpwxzck93qlwghaj6arh4p7c5n896xzem5",
    tokenBridge: "terra10pyejy66429refv3g35g2t7am0was7ya7kz2a4",
  },
  tilt: {
    wormhole: "terra18vd8fpwxzck93qlwghaj6arh4p7c5n896xzem5",
    tokenBridge: "terra10pyejy66429refv3g35g2t7am0was7ya7kz2a4",
  },
};

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
  wallet: any,
  wormhole: string,
  tokenBridge: string
) {
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
