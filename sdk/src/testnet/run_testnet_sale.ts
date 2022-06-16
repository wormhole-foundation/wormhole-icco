import { expect } from "chai";
import {
  /*, 
  waitForSaleToEnd,
  attestAndCollectContributionsOnEth,
  sealOrAbortSaleOnEth,
  sealSaleAtContributors,
  redeemCrossChainAllocations,
  claimContributorAllocationOnEth,
  redeemCrossChainContributions,
  abortSaleEarlyAtConductor,
  abortSaleEarlyAtContributor,
  testProvider,
  abortSaleAtContributors,
  extractVaaPayload,
  parseVaaPayload,
  collectContributionsOnConductor,*/
  initiatorWallet,
  buildAcceptedTokens,
  createSaleOnEthConductor,
  initializeSaleOnEthContributors,
  waitForSaleToStart,
  prepareAndExecuteContribution,
} from "./utils";
import {
  SALE_CONFIG,
  TESTNET_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_INFO,
  CONTRIBUTOR_NETWORKS,
  CONDUCTOR_ADDRESS,
  CHAIN_ID_TO_NETWORK,
} from "./consts";
import { Contribution, saleParams, SealSaleResult } from "./structs";
import {
  setDefaultWasm,
  uint8ArrayToHex,
  CHAIN_ID_SOLANA,
  tryUint8ArrayToNative,
  tryHexToNativeString,
  getEmitterAddressSolana,
} from "@certusone/wormhole-sdk";
import { Conductor__factory, getSaleFromConductorOnEth, getSaleFromContributorOnEth, parseSolanaSaleInit } from "../";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";

setDefaultWasm("node");

describe("Testnet ICCO Successful Sales", () => {
  it("Fixedprice With Lock Up", async () => {
    // const program = createContributorProgram();

    // setup sale variables
    const raiseParams: saleParams = SALE_CONFIG["raiseParams"];

    // create the sale token ATA
    // TO-DO: need to init sale with the sale token account
    /*const saleTokenAta = await createCustodianATAForSaleToken(
          program,
          raiseParams.solanaTokenAccount
        );
        console.log(saleTokenAta);*/

    // build the accepted token list
    const acceptedTokens = await buildAcceptedTokens(SALE_CONFIG["acceptedTokens"]);

    // create and initialize the sale
    const saleInitArray = await createSaleOnEthConductor(
      initiatorWallet(CONDUCTOR_NETWORK),
      TESTNET_ADDRESSES.conductorAddress,
      raiseParams,
      acceptedTokens
    );

    // // initialize the sale on the contributors
    const saleInit = await initializeSaleOnEthContributors(saleInitArray[0]);
    console.log(saleInit);
    console.info("Sale", saleInit.saleId, "has been initialized on the EVM contributors.");

    // initialize the sale on solana contributor if accepting solana tokens
    /*let solanaSaleInit;
    if (saleInitArray.length > 1) {
      solanaSaleInit = await initializeSaleOnSolanaContributor(program, Buffer.from(saleInitArray[1]));
      console.log(solanaSaleInit);
      console.info("Sale", solanaSaleInit.saleId, "has been initialized on the Solana contributor.");
    }*/

    // continue with the sale if it wasn't aborted early
    let successfulContributions: Contribution[] = [];

    // wait for the sale to start before contributing
    console.info("Waiting for the sale to start...");
    const extraTime: number = 5; // wait an extra 5 seconds
    await waitForSaleToStart(saleInit, extraTime);

    // loop through contributors and safe contribute one by one
    const contributions: Contribution[] = CONTRIBUTOR_INFO["contributions"];
    for (const contribution of contributions) {
      let successful = false;
      // check if we're contributing a solana token
      if (contribution.chainId == CHAIN_ID_SOLANA) {
        /*successful = await prepareAndExecuteContributionOnSolana(
          program,
          Buffer.from(saleInitArray[1]),
          contributions[i]
        );*/
      } else {
        successful = await prepareAndExecuteContribution(saleInit.saleId, raiseParams.token, contribution);
      }

      if (successful) {
        successfulContributions.push(contribution);
      } else {
        console.log("Contribution failed for token:", contribution.address);
      }
    }
    console.log(successfulContributions.length, "successful contributions recorded.");

    /*// wait for sale to end
    console.log("Waiting for the sale to end...");
    await waitForSaleToEnd(saleInit, 10);
    // attest and collect contributions on EVM
    await attestAndCollectContributionsOnEth(saleInit);

    // seal the sale on the conductor contract
    const saleResult: SealSaleResult = await sealOrAbortSaleOnEth(saleInit);
    console.log("Sale results have been finalized.");*/

    /*// check to see if the sale failed, abort and refund folks if so
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
      
        // redeem transfer VAAs for conductor
        for (let [chainId, receipt] of saleSealedResults[1]) {
          await redeemCrossChainContributions(receipt, chainId);
        }*/
  });
});
