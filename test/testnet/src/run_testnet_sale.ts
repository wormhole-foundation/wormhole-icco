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
  redeemCrossChainContributions,
  abortSaleEarlyAtConductor,
  abortSaleEarlyAtContributor,
  testProvider,
  abortSaleAtContributors,
} from "./utils";
import {
  SALE_CONFIG,
  TESTNET_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_INFO,
  CONTRIBUTOR_NETWORKS,
  CONDUCTOR_ADDRESS,
} from "./consts";
import { Contribution, saleParams, SealSaleResult } from "./structs";
import { setDefaultWasm } from "@certusone/wormhole-sdk";
import {
  getSaleFromConductorOnEth,
  getSaleFromContributorOnEth,
} from "wormhole-icco-sdk";

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

  // test aborting the sale early
  let saleTerminatedEarly = false;

  if (SALE_CONFIG["testParams"].abortSaleEarly) {
    console.log("Aborting sale early on the Conductor.");
    // abort the sale early in the conductor
    const abortEarlyReceipt = await abortSaleEarlyAtConductor(saleInit);

    console.log("Aborting sale early on the Contributors.");
    await abortSaleEarlyAtContributor(saleInit, abortEarlyReceipt);

    saleTerminatedEarly = true;
  }

  // continue with the sale if it wasn't aborted early
  let saleResult: SealSaleResult;
  let successfulContributions: Contribution[] = [];

  if (!saleTerminatedEarly) {
    // wait for the sale to start before contributing
    console.info("Waiting for the sale to start...");
    const extraTime: number = 5; // wait an extra 5 seconds
    await waitForSaleToStart(saleInit, extraTime);

    // loop through contributors and safe contribute one by one
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

    // seal the sale on the conductor contract
    saleResult = await sealOrAbortSaleOnEth(saleInit);
    console.log("Sale results have been finalized.");
  } else {
    console.log("Skipping contributions, the sale was aborted early!");
  }

  // check to see if the sale failed, abort and refund folks if so
  const conductorSale = await getSaleFromConductorOnEth(
    CONDUCTOR_ADDRESS,
    testProvider(CONDUCTOR_NETWORK),
    saleInit.saleId
  );

  if (conductorSale.isAborted || saleTerminatedEarly) {
    // abort on the contributors if not saleTerminatedEarly
    if (!saleTerminatedEarly) {
      await abortSaleAtContributors(saleResult);
    }
    // confirm that the sale was aborted on each contributor
    for (let i = 0; i < CONTRIBUTOR_NETWORKS.length; i++) {
      let network = CONTRIBUTOR_NETWORKS[i];
      const contributorSale = await getSaleFromContributorOnEth(
        TESTNET_ADDRESSES[network],
        testProvider(network),
        saleInit.saleId
      );
      if (contributorSale.isAborted) {
        console.log("Successfully aborted sale on contributor:", network);
      } else {
        console.log("Failed to abort the sale on contributor:", network);
      }
    }
    return;
  }

  // redeem the transfer VAAs on all chains
  await redeemCrossChainAllocations(saleResult);

  // seal the sale on the Contributor contracts
  const saleSealedResults = await sealSaleAtContributors(saleInit, saleResult);

  // claim allocations on contributors
  for (let i = 0; i < successfulContributions.length; i++) {
    const successful = await claimContributorAllocationOnEth(
      saleSealedResults[0],
      successfulContributions[i]
    );
    console.log("Allocation", i, "was claimed successfully:", successful);
  }

  // redeem VAAs for conductor
  for (let [chainId, receipt] of saleSealedResults[1]) {
    await redeemCrossChainContributions(receipt, chainId);
  }
}

main();
