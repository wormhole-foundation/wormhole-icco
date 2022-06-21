t adimport { expect } from "chai";
import {
  initiatorWallet,
  buildAcceptedTokens,
  createSaleOnEthConductor,
  initializeSaleOnEthContributors,
  waitForSaleToStart,
  prepareAndExecuteContribution,
  waitForSaleToEnd,
  sealOrAbortSaleOnEth,
  sealSaleAtEthContributors,
  redeemCrossChainAllocations,
  claimContributorAllocationOnEth,
  redeemCrossChainContributions,
  abortSaleEarlyAtConductor,
  abortSaleEarlyAtContributor,
  testProvider,
  abortSaleAtContributors,
  extractVaaPayload,
  parseVaaPayload,
  collectContributionsOnConductor,
  attestContributionsOnContributor,
  getOriginalTokenBalance,
  getSaleTokenBalancesOnContributors,
  balancesAllGreaterThan,
  findUniqueContributions,
  excessContributionsExistForSale,
  claimContributorExcessContributionOnEth,
} from "./utils";
import {
  SALE_CONFIG,
  TESTNET_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_INFO,
  CONTRIBUTOR_NETWORKS,
  CONDUCTOR_ADDRESS,
  CHAIN_ID_TO_NETWORK,
  WORMHOLE_ADDRESSES,
  CONDUCTOR_CHAIN_ID,
} from "./consts";
import { Contribution, SaleParams, SealSaleResult } from "./structs";
import {
  setDefaultWasm,
  uint8ArrayToHex,
  CHAIN_ID_SOLANA,
  tryUint8ArrayToNative,
  tryHexToNativeString,
  getEmitterAddressSolana,
} from "@certusone/wormhole-sdk";
import { MockSale } from "./testCalculator";
import { Conductor__factory, getSaleFromConductorOnEth, getSaleFromContributorOnEth, parseSolanaSaleInit } from "../";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { ethers } from "ethers";

setDefaultWasm("node");

describe("Testnet ICCO Successful Sales", () => {
  it("Fixed-price With Lock Up", async () => {
    // const program = createContributorProgram();

    // sale parameters
    const raiseParams: SaleParams = SALE_CONFIG["raiseParams"];
    const contributions: Contribution[] = CONTRIBUTOR_INFO["contributions"];
    const acceptedTokens = await buildAcceptedTokens(SALE_CONFIG["acceptedTokens"]);

    // test calculator object
    const mockSale = new MockSale(
      CONDUCTOR_CHAIN_ID,
      SALE_CONFIG["denominationDecimals"],
      acceptedTokens,
      raiseParams,
      contributions
    );
    const mockSaleResults = await mockSale.getResults();

    // create the sale token ATA
    // TO-DO: need to init sale with the sale token account
    /*const saleTokenAta = await createCustodianATAForSaleToken(
          program,
          raiseParams.solanaTokenAccount
        );
        console.log(saleTokenAta);*/

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

    // wait for the sale to start before contributing
    console.info("Waiting for the sale to start.");
    const extraTime: number = 5; // wait an extra 5 seconds
    await waitForSaleToStart(saleInit, extraTime);

    // loop through contributors and safe contribute one by one
    console.log("Making contributions to the sale.");
    for (const contribution of contributions) {
      let successful = false;
      // check if we're contributing a solana token
      if (contribution.chainId == CHAIN_ID_SOLANA) {
        // TO-DO
        /*successful = await prepareAndExecuteContributionOnSolana(
          program,
          Buffer.from(saleInitArray[1]),
          contributions[i]
        );*/
      } else {
        successful = await prepareAndExecuteContribution(saleInit.saleId, raiseParams.token, contribution);
      }
      expect(successful, "Contribution failed").to.be.true;
    }

    // wait for sale to end
    console.log("Waiting for the sale to end.");
    await waitForSaleToEnd(saleInit, 10);

    // attest and collect contributions on EVM
    const attestVaas: Uint8Array[] = await attestContributionsOnContributor(saleInit);
    console.log("Successfully attested contributions on", attestVaas.length, "chains.");

    // collect contributions on the conductor
    const collectionResults = await collectContributionsOnConductor(attestVaas, saleInit.saleId);
    for (const result of collectionResults) {
      expect(result, "Failed to collect all contributions on the conductor.").to.be.true;
    }
    console.log("Successfully collected contributions on the conductor.");

    // seal the sale on the conductor
    // make sure tokenBridge transfers are redeemed
    // check contributor sale token balances before and after
    // check to see if the recipient received refund in fixed-price sale
    let saleResult: SealSaleResult;
    {
      const saleTokenBalancesBefore = await getSaleTokenBalancesOnContributors(
        raiseParams.token,
        raiseParams.tokenChain
      );

      // seal the sale on the conductor contract
      saleResult = await sealOrAbortSaleOnEth(saleInit);
      expect(saleResult.sale.isSealed, "Sale was not sealed").to.be.true;

      // redeem the transfer VAAs on all chains
      await redeemCrossChainAllocations(saleResult);

      const saleTokenBalancesAfter = await getSaleTokenBalancesOnContributors(
        raiseParams.token,
        raiseParams.tokenChain
      );

      // this should only fail if one of the contributors doesn't make a contribution
      expect(
        await balancesAllGreaterThan(saleTokenBalancesBefore, saleTokenBalancesAfter),
        "Sale token balance didn't change."
      ).to.be.true;
    }

    // seal the sale at the contributors
    // TO-DO: balance check the recipients wallet to make sure they recieved the contributed tokens
    let saleSealedResults;
    {
      // seal the sale on the Contributor contracts
      saleSealedResults = await sealSaleAtEthContributors(saleInit, saleResult);

      // redeem transfer VAAs for conductor
      for (let [chainId, receipt] of saleSealedResults[1]) {
        if (chainId != CONDUCTOR_CHAIN_ID) {
          await redeemCrossChainContributions(receipt, chainId);
        }
      }
    }

    // claim allocations on contributors
    // find unique contributions to claim
    const uniqueContributors = findUniqueContributions(contributions, acceptedTokens);

    console.log("Claiming contributor allocations and excessContributions if applicable.");
    for (let i = 0; i < uniqueContributors.length; i++) {
      const successful = await claimContributorAllocationOnEth(saleSealedResults[0], uniqueContributors[i]);
      expect(successful, "Failed to claim allocation").to.be.true;

      // check to see if there are any excess contributions to claim
      if (await excessContributionsExistForSale(saleInit.saleId, uniqueContributors[i])) {
        const successful = await claimContributorExcessContributionOnEth(saleSealedResults[0], uniqueContributors[i]);
        expect(successful, "Failed to claim excessContribution").to.be.true;
      }
    }
  });
});
