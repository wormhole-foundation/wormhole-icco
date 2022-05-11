const fs = require("fs");
import {
  buildAcceptedTokens,
  createSaleOnEthAndInit,
  initiatorWallet,
  waitForSaleToStart,
  prepareAndExecuteContribution,
  waitForSaleToEnd,
  attestAndCollectContributions,
  sealOrAbortSaleOnEth,
  sealSaleAtContributors,
  redeemCrossChainAllocations,
  claimContributorAllocationOnEth,
} from "./utils";
import {
  SALE_CONFIG,
  TESTNET_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_INFO,
} from "./consts";
import { Contribution, saleParams, SealSaleResult } from "./structs";
import { setDefaultWasm } from "@certusone/wormhole-sdk";

setDefaultWasm("node");

async function main() {
  // setup sale variables
  const raiseParams: saleParams = SALE_CONFIG["raiseParams"];

  // build the accepted token list
  const acceptedTokens = await buildAcceptedTokens(
    SALE_CONFIG["acceptedTokens"]
  );

  // create and initialize the sale
  const saleInit = await createSaleOnEthAndInit(
    initiatorWallet(CONDUCTOR_NETWORK),
    TESTNET_ADDRESSES.conductorAddress,
    TESTNET_ADDRESSES.conductorChain,
    raiseParams,
    acceptedTokens
  );
  console.log(saleInit);
  console.info("Sale", saleInit.saleId, "has been initialized.");

  // wait for the sale to start before contributing
  console.info("Waiting for the sale to start...");
  const extraTime: number = 5; // wait an extra 5 seconds
  await waitForSaleToStart(saleInit, extraTime);

  // loop through contributors and safe contribute one by one
  const successfulContributions: Contribution[] = [];

  const contributions: Contribution[] = CONTRIBUTOR_INFO["contributions"];
  for (let i = 0; i < contributions.length; i++) {
    const successful = await prepareAndExecuteContribution(
      saleInit.saleId,
      raiseParams.token,
      contributions[i]
    );
    if (successful) {
      console.info("Contribution successful for contribution:", i);
      successfulContributions.push(contributions[i]);
    } else {
      console.log("Contribution failed for contribution:", i);
    }
  }

  // wait for sale to end
  console.log("Waiting for the sale to end...");
  await waitForSaleToEnd(saleInit, 10);

  // attest contributions on each contributor and collect contributions in conductor
  await attestAndCollectContributions(saleInit);

  // seal the sale on the Conductor contract
  const saleResult: SealSaleResult = await sealOrAbortSaleOnEth(saleInit);
  console.log("Sale results have been finalized.");

  // redeem the transfer VAAs on all chains
  await redeemCrossChainAllocations(saleResult);

  // seal the sale on the Contributor contracts
  const saleSealed = await sealSaleAtContributors(saleInit, saleResult);

  // claim allocations on contributors
  for (let i = 0; i < successfulContributions.length; i++) {
    const successful = await claimContributorAllocationOnEth(
      saleSealed,
      successfulContributions[i]
    );
    console.log("Allocation", i, "was claimed successfully:", successful);
  }
}

main();
