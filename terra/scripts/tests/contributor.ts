import { LCDClient, Wallet } from "@terra-money/terra.js";
import { WORMHOLE_ADDRESSES } from "../consts";
import {
  instantiateContract,
  newLocalClient,
  uploadContract,
} from "../helpers";

const contracts = new Map<string, string>();

async function main() {
  const { terra, wallet } = newLocalClient();

  console.log("-------- Deployment --------\n");
  await deployment(terra, wallet);
  console.log();

  console.log("-------- Conduct Successful Sale --------\n");
  await conductSuccessfulSale(terra, wallet);
  console.log();

  console.log("-------- Conduct Aborted Sale --------\n");
  await conductAbortedSale(terra, wallet);
  console.log();
  return;
}

function logTestName(test: string): void {
  console.log("\x1b[33m%s\x1b[0m", test);
}

function success(): void {
  console.log("... \x1b[32msuccess!\x1b[0m");
}

function untested(): void {
  console.log("... \x1b[31muntested\x1b[0m");
}

async function deployment(terra: LCDClient, wallet: Wallet): Promise<void> {
  {
    logTestName("1. Deploy Contract");
    const addresses = WORMHOLE_ADDRESSES.localterra;

    const codeId = await uploadContract(
      terra,
      wallet,
      "../artifacts/icco_contributor.wasm"
    );

    const contributor = await instantiateContract(
      terra,
      wallet,
      wallet.key.accAddress,
      codeId,
      {
        wormhole: addresses.wormhole,
        token_bridge: addresses.tokenBridge,
        conductor_chain: 2,
        conductor_address: "",
      }
    );
    contracts.set("contributor", contributor);
    success();
  }

  {
    logTestName("2. Upgrade Contract");
    untested();
  }

  // done
  return;
}

async function conductSuccessfulSale(
  terra: LCDClient,
  wallet: Wallet
): Promise<void> {
  const sale = {};

  {
    logTestName("1. Orchestrator Initializes Sale... ");
    // Conductor will have produced a VAA. Here we fabricate the VAA and
    // forge a signature with devnet guardian

    untested();
  }

  {
    logTestName("2. User Contributes to Sale");
    untested();
  }

  {
    logTestName("3. Orchestrator Attests Contributions");
    untested();
  }

  {
    logTestName("4. Orchestrator Seals Sale");
    untested();
  }

  {
    logTestName("5. User Claims Allocations");
    untested();
  }

  return;
}

async function conductAbortedSale(
  terra: LCDClient,
  wallet: Wallet
): Promise<void> {
  {
    logTestName("1. Orchestrator Initializes Sale");
    untested();
  }

  {
    logTestName("2. User Contributes to Sale");
    untested();
  }

  {
    logTestName("3. Orchestrator Attests Contributions");
    untested();
  }

  {
    logTestName("4. Orchestrator Aborts Sale");
    untested();
  }

  {
    logTestName("5. User Claims Refunds");
    untested();
  }

  return;
}

main();
