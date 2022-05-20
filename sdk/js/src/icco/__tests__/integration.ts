import { describe, expect, jest, test } from "@jest/globals";
import { ethers } from "ethers";
import {
  CHAIN_ID_BSC,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  nativeToHexString,
  redeemOnEth,
  setDefaultWasm,
} from "@certusone/wormhole-sdk";

import {
  attestContributionsOnEth,
  getContributorContractOnEth,
  getSaleFromConductorOnEth,
  getSaleFromContributorOnEth,
  nativeToUint8Array,
  sealSaleOnEth,
} from "../..";
import {
  BSC_NODE_URL,
  ETH_NODE_URL,
  ETH_PRIVATE_KEY1,
  ETH_PRIVATE_KEY2,
  ETH_PRIVATE_KEY3,
  ETH_PRIVATE_KEY4,
  ETH_PRIVATE_KEY5,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  TOKEN_SALE_CONTRIBUTOR_ADDRESSES,
  WBNB_ADDRESS,
  WETH_ADDRESS,
  DENOMINATION_DECIMALS,
} from "./consts";
import {
  EthBuyerConfig,
  EthContributorConfig,
  createSaleOnEthAndInit,
  waitForSaleToEnd,
  waitForSaleToStart,
  makeAcceptedTokensFromConfigs,
  sealOrAbortSaleOnEth,
  secureContributeAllTokensOnEth,
  getCollateralBalancesOnEth,
  claimAllAllocationsOnEth,
  getAllocationBalancesOnEth,
  contributionsReconcile,
  allocationsReconcile,
  claimAllBuyerRefundsOnEth,
  refundsReconcile,
  prepareBuyersForMixedContributionTest,
  makeSaleStartFromLastBlock,
  sealSaleAtContributors,
  abortSaleAtContributors,
  claimConductorRefund,
  claimOneContributorRefundOnEth,
  redeemCrossChainAllocations,
  attestSaleToken,
  getWrappedCollateral,
  getRefundRecipientBalanceOnEth,
  abortSaleEarlyAtContributors,
  abortSaleEarlyAtConductor,
  deployTokenOnEth,
} from "./helpers";

// ten minutes? nobody got time for that
jest.setTimeout(600000);

setDefaultWasm("node");

// TODO: setup keypair and provider/signer before, destroy provider after
// TODO: make the repeatable (can't attest an already attested token)

describe("Integration Tests", () => {
  describe("Conduct ICCO on Ethereum", () => {
    test("Check Registered Contributors on Ethereum Conductor", (done) => {
      (async () => {
        try {
          // TODO: double-check this
          const provider = new ethers.providers.WebSocketProvider(ETH_NODE_URL);

          // register eth contributor
          const ethContributorAddress =
            TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_ETH);
          if (ethContributorAddress === undefined) {
            throw Error("ethContributorAddress is undefined");
          }

          const ethContributorHexString = nativeToHexString(
            ethContributorAddress,
            CHAIN_ID_ETH
          );

          {
            const registered = await getContributorContractOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              provider,
              CHAIN_ID_ETH
            );
            expect(registered.slice(2)).toEqual(ethContributorHexString);
          }

          // register bsc contributor
          const bscContributorAddress =
            TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_BSC);
          if (bscContributorAddress === undefined) {
            throw Error("bscContributorAddress is undefined");
          }

          const bscContributorHexString = nativeToHexString(
            bscContributorAddress,
            CHAIN_ID_BSC
          );
          {
            const registered = await getContributorContractOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              provider,
              CHAIN_ID_BSC
            );
            expect(registered.slice(2)).toEqual(bscContributorHexString);
          }
          provider.destroy();
          done();
        } catch (e) {
          console.error(e);
          done(
            "An error occurred while trying to Check Registered Contributors on Ethereum Conductor"
          );
        }
      })();
    });
    test("Create Successful ICCO Sale With Mixed Contributions", (done) => {
      (async () => {
        try {
          const ethProvider = new ethers.providers.WebSocketProvider(
            ETH_NODE_URL
          );
          const bscProvider = new ethers.providers.WebSocketProvider(
            BSC_NODE_URL
          );

          // seller
          const contributorConfigs: EthContributorConfig[] = [
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, ethProvider),
              collateralAddress: WETH_ADDRESS,
              conversionRate: "1",
            },
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              conversionRate: "0.2",
            },
          ];

          const wormholeWrapped = await getWrappedCollateral(
            contributorConfigs
          );

          // pk2 := weth contributors, pk3 := wbnb contributors
          const buyers: EthBuyerConfig[] = [
            // native weth
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, ethProvider),
              collateralAddress: WETH_ADDRESS,
              contribution: "6",
              tokenIndex: 0,
            },
            // native wbnb
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "20",
              tokenIndex: 1,
            },
            // wormhole wrapped bnb
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, ethProvider),
              collateralAddress: wormholeWrapped.wbnbOnEth,
              contribution: "3",
              tokenIndex: 2,
            },
            // wormhole wrapped weth
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, bscProvider),
              collateralAddress: wormholeWrapped.wethOnBsc,
              contribution: "5",
              tokenIndex: 3,
            },
            // and another native wbnb contribution
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY4, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "6",
              tokenIndex: 1,
            },
            // and ANOTHER native wbnb contribution
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY5, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "9",
              tokenIndex: 1,
            },
          ];

          // specific prep so buyers can make contributions from their respective wallets
          const wrapIndices = [0, 1, 4, 5];
          const transferFromIndices = [0, 1];
          const transferToIndices = [3, 2];
          await prepareBuyersForMixedContributionTest(
            buyers,
            wrapIndices,
            transferFromIndices,
            transferToIndices
          );

          // we need to set up all of the accepted tokens (natives plus their wrapped versions)
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers,
            DENOMINATION_DECIMALS
          );

          // add fake terra and solana tokens to acceptedTokens
          /*acceptedTokens.push(makeAcceptedToken(
              3,
              'terra13nkgqrfymug724h8pprpexqj9h629sa3ncw7sh',
              "1"
          ));
          acceptedTokens.push(makeAcceptedToken(
              1,
              '2WDq7wSs9zYrpx2kbHDA4RUTRch2CCTP6ZWaH4GNfnQQ',
              ".4"
          ));*/

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          // make sale token. mint 10 and sell 10%
          const tokenAddress = await deployTokenOnEth(
            ETH_NODE_URL,
            "Icco-Test",
            "ICCO",
            ethers.utils.parseUnits("10").toString(),
            conductorConfig.wallet
          );

          const tokenChain = CHAIN_ID_ETH; // needed to check if token is native or not
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const maxRaise = "14";
          const saleDuration = 60; // seconds

          // get the time
          const saleStart = await makeSaleStartFromLastBlock(
            contributorConfigs
          );

          // the token being sold is on eth
          // which means it has the same local token address
          const localTokenAddress = tokenAddress;

          // create fake solana ATA
          const solanaTokenAccount = nativeToUint8Array(
            localTokenAddress,
            CHAIN_ID_ETH // will be CHAIN_ID_SOLANA with a real token
          );

          console.log(solanaTokenAccount);

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            localTokenAddress,
            tokenAddress,
            tokenChain,
            tokenAmount,
            minRaise,
            maxRaise,
            saleStart,
            saleDuration,
            acceptedTokens,
            solanaTokenAccount
          );
          console.log("Parsed Sale Init:", saleInit);

          // balance check
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // hold your horses
            await waitForSaleToStart(contributorConfigs, saleInit, 5);

            // finally buyers contribute
            const contributionSuccessful = await secureContributeAllTokensOnEth(
              saleInit,
              buyers,
              tokenAddress, // sale token,
              ETH_NODE_URL
            );
            expect(contributionSuccessful).toBeTruthy();

            const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);
            const allLessThan = buyerBalancesAfter
              .map((balance, index) => {
                return ethers.BigNumber.from(balance).lt(
                  buyerBalancesBefore[index]
                );
              })
              .reduce((prev, curr) => {
                return prev && curr;
              });
            expect(allLessThan).toBeTruthy();

            // we expect that balances before minus balances after equals the contributions
            const reconciled = await contributionsReconcile(
              saleInit,
              buyers,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(reconciled).toBeTruthy();
          }

          // hold your horses again
          await waitForSaleToEnd(contributorConfigs, saleInit, 5);

          // EXPECTED ERROR: sale has ended if anyone tries to contribute after the sale
          {
            // specific prep so buyers can make contributions from their respective wallets
            const wrapIndices = [0, 1, 4, 5];
            const transferFromIndices = [0, 1];
            const transferToIndices = [3, 2];
            await prepareBuyersForMixedContributionTest(
              buyers,
              wrapIndices,
              transferFromIndices,
              transferToIndices
            );

            let expectedErrorExists = false;
            try {
              // buyers contribute
              const contributionSuccessful =
                await secureContributeAllTokensOnEth(
                  saleInit,
                  buyers,
                  tokenAddress, // sale token,
                  ETH_NODE_URL
                );
            } catch (error: any) {
              const errorMsg: string = error.error.toString();
              if (errorMsg.endsWith("sale has ended")) {
                expectedErrorExists = true;
              } else {
                throw Error(error);
              }
            }
            expect(expectedErrorExists).toBeTruthy();
          }

          // before sealing the sale, check the balance of the distribution token
          // on the refundRecipient address. Then check again to double-check the dust
          // calculation after allocations have been sent
          const recipientBalanceBefore = await getRefundRecipientBalanceOnEth(
            saleInit,
            conductorConfig
          );

          // now seal the sale
          const saleResult = await sealOrAbortSaleOnEth(
            saleInit,
            conductorConfig,
            contributorConfigs
          );
          expect(saleResult.sale.isSealed).toBeTruthy();

          // we need to make sure the distribution token is attested before we consider seling it cross-chain
          await attestSaleToken(
            tokenAddress,
            conductorConfig,
            contributorConfigs
          );

          // EXPECT ERROR: should not be able to seal the sale before allocations have been sent to contributors
          {
            let expectedErrorExists = false;
            try {
              const relevantConfigs = contributorConfigs.filter(
                (config): boolean => {
                  return config.chainId !== conductorConfig.chainId;
                }
              );
              const saleSealed = await sealSaleAtContributors(
                saleInit,
                saleResult,
                relevantConfigs
              );
            } catch (error: any) {
              const errorMsg: string = error.error.toString();
              if (errorMsg.endsWith("sale token balance must be non-zero")) {
                expectedErrorExists = true;
              } else {
                throw Error(error);
              }
            }
            expect(expectedErrorExists).toBeTruthy();
          }

          // EXPECT ERROR: redeem one transfer, but cannot seal the sale due to insufficient balance
          {
            const signedVaas = saleResult.transferVaas.get(
              contributorConfigs[1].chainId
            );

            if (signedVaas === undefined) {
              throw Error("cannot find signedVaas for contributor to redeem");
            }
            const signedVaa = signedVaas.pop();
            if (signedVaa === undefined) {
              throw Error("signedVaas is empty");
            }

            // redeem only one
            {
              const receipt = await redeemOnEth(
                ETH_TOKEN_BRIDGE_ADDRESS,
                contributorConfigs[1].wallet,
                signedVaa
              );
            }

            let expectedErrorExists = false;
            try {
              const relevantConfigs = contributorConfigs.filter(
                (config): boolean => {
                  return config.chainId !== conductorConfig.chainId;
                }
              );
              const saleSealed = await sealSaleAtContributors(
                saleInit,
                saleResult,
                relevantConfigs
              );
            } catch (error: any) {
              const errorMsg: string = error.error.toString();
              if (errorMsg.endsWith("insufficient sale token balance")) {
                expectedErrorExists = true;
              } else {
                throw Error(error);
              }
            }
            expect(expectedErrorExists).toBeTruthy();
          }

          // redeem token transfer vaas
          {
            const receipts = await redeemCrossChainAllocations(
              saleResult,
              contributorConfigs
            );
          }

          // seal the sale at the contributors, then check balances
          const saleSealed = await sealSaleAtContributors(
            saleInit,
            saleResult,
            contributorConfigs
          );
          console.info("Parsed Sale Sealed:", saleSealed);

          const recipientBalanceAfter = await getRefundRecipientBalanceOnEth(
            saleInit,
            conductorConfig
          );
          expect(
            recipientBalanceAfter.gte(recipientBalanceBefore)
          ).toBeTruthy();

          {
            const tokenAmount = ethers.BigNumber.from(saleInit.tokenAmount);

            const totalAllocated = saleSealed.allocations
              .map((item): ethers.BigNumber => {
                return ethers.BigNumber.from(item.allocation);
              })
              .reduce((prev, curr): ethers.BigNumber => {
                return prev.add(curr);
              });

            expect(tokenAmount.gte(totalAllocated)).toBeTruthy();

            const dust = tokenAmount.sub(totalAllocated);
            expect(
              recipientBalanceAfter.sub(recipientBalanceBefore).eq(dust)
            ).toBeTruthy();
          }

          // balance check contributed tokens in case
          // the maxRaise threshold is exceeded
          const buyerCollateralBalancesBefore =
            await getCollateralBalancesOnEth(buyers);

          // balance check of distributed token to buyers
          {
            const buyerBalancesBefore = await getAllocationBalancesOnEth(
              saleInit,
              buyers
            );
            const claimsSuccessful = await claimAllAllocationsOnEth(
              saleSealed,
              buyers
            );
            expect(claimsSuccessful).toBeTruthy();

            const buyerBalancesAfter = await getAllocationBalancesOnEth(
              saleInit,
              buyers
            );

            const allGreaterThan = buyerBalancesAfter
              .map((balance, index) => {
                return ethers.BigNumber.from(balance).gt(
                  buyerBalancesBefore[index]
                );
              })
              .reduce((prev, curr) => {
                return prev && curr;
              });
            expect(allGreaterThan).toBeTruthy();

            const allocationsReconciled = await allocationsReconcile(
              saleInit,
              buyers,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(allocationsReconciled).toBeTruthy();
          }

          // balance check collateral tokens paid to contributors
          // if maxRaise is exceeded
          {
            // check to see if maxRaise threshold was hit
            const conductorSale = await getSaleFromConductorOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              conductorConfig.wallet.provider,
              saleInit.saleId
            );
            const contributions = conductorSale.contributions;
            const tokenConversions =
              conductorSale.acceptedTokensConversionRates;
            const adjustment = ethers.utils.parseUnits("1");

            // compute the total contributions for the sale
            const totalContributions = contributions
              .map((contribution, i) => {
                return ethers.BigNumber.from(contribution)
                  .mul(tokenConversions[i])
                  .div(adjustment);
              })
              .reduce((prev, curr) => {
                return prev.add(curr);
              });

            if (totalContributions.gt(ethers.utils.parseUnits(maxRaise))) {
              console.log("Checking if excess contributions were paid out...");
              // do balance check here
              const buyerCollateralBalancesAfter =
                await getCollateralBalancesOnEth(buyers);
              const allGreaterThan = buyerCollateralBalancesAfter
                .map((balance, index) => {
                  return ethers.BigNumber.from(balance).gt(
                    buyerCollateralBalancesBefore[index]
                  );
                })
                .reduce((prev, curr) => {
                  return prev && curr;
                });
              expect(allGreaterThan).toBeTruthy();
            }
          }

          ethProvider.destroy();
          bscProvider.destroy();

          done();
        } catch (e) {
          console.error(e);
          done(
            "An error occurred while trying to Create Successful Sale With Mixed Contributions"
          );
        }
      })();
    });
    test("Execute Aborted ICCO Sale with Raise Not Met", (done) => {
      (async () => {
        try {
          const ethProvider = new ethers.providers.WebSocketProvider(
            ETH_NODE_URL
          );
          const bscProvider = new ethers.providers.WebSocketProvider(
            BSC_NODE_URL
          );

          // seller
          const contributorConfigs: EthContributorConfig[] = [
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, ethProvider),
              collateralAddress: WETH_ADDRESS,
              conversionRate: "1",
            },
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              conversionRate: "0.2",
            },
          ];

          const wormholeWrapped = await getWrappedCollateral(
            contributorConfigs
          );

          // pk2 := weth contributors, pk3 := wbnb contributors
          const buyers: EthBuyerConfig[] = [
            // native weth
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, ethProvider),
              collateralAddress: WETH_ADDRESS,
              contribution: "3",
              tokenIndex: 0,
            },
            // native wbnb
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "10",
              tokenIndex: 1,
            },
            // wormhole wrapped bnb
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, ethProvider),
              collateralAddress: wormholeWrapped.wbnbOnEth,
              contribution: "5",
              tokenIndex: 2,
            },
            // wormhole wrapped weth
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, bscProvider),
              collateralAddress: wormholeWrapped.wethOnBsc,
              contribution: "2.99999999",
              tokenIndex: 3,
            },
            // and another native wbnb contribution
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY4, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "3",
              tokenIndex: 1,
            },
            // and ANOTHER native wbnb contribution
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY5, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "2",
              tokenIndex: 1,
            },
          ];

          // specific prep so buyers can make contributions from their respective wallets
          const wrapIndices = [0, 1, 4, 5];
          const transferFromIndices = [0, 1];
          const transferToIndices = [3, 2];
          await prepareBuyersForMixedContributionTest(
            buyers,
            wrapIndices,
            transferFromIndices,
            transferToIndices
          );

          // we need to set up all of the accepted tokens (natives plus their wrapped versions)
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers,
            DENOMINATION_DECIMALS
          );

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          // make sale token. mint 10 and sell 10%
          const tokenAddress = await deployTokenOnEth(
            ETH_NODE_URL,
            "Icco-Test2",
            "ICCO2",
            ethers.utils.parseUnits("10").toString(),
            conductorConfig.wallet
          );

          const tokenChain = CHAIN_ID_ETH; // needed to check if token is native or not
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const maxRaise = "100";
          const saleDuration = 60; // seconds

          // get the time
          const saleStart = await makeSaleStartFromLastBlock(
            contributorConfigs
          );

          // the token being sold is on eth
          // which means it has the same local token address
          const localTokenAddress = tokenAddress;

          // create fake solana ATA
          const solanaTokenAccount = nativeToUint8Array(
            localTokenAddress,
            CHAIN_ID_ETH // will be CHAIN_ID_SOLANA with a real token
          );

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            localTokenAddress,
            tokenAddress,
            tokenChain,
            tokenAmount,
            minRaise,
            maxRaise,
            saleStart,
            saleDuration,
            acceptedTokens,
            solanaTokenAccount
          );
          console.log("Parsed Sale Init:", saleInit);

          // balance check
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // hold your horses
            await waitForSaleToStart(contributorConfigs, saleInit, 5);

            // finally buyers contribute
            const contributionSuccessful = await secureContributeAllTokensOnEth(
              saleInit,
              buyers,
              tokenAddress, // sale token
              ETH_NODE_URL
            );
            expect(contributionSuccessful).toBeTruthy();

            const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);
            const allLessThan = buyerBalancesAfter
              .map((balance, index) => {
                return ethers.BigNumber.from(balance).lt(
                  buyerBalancesBefore[index]
                );
              })
              .reduce((prev, curr) => {
                return prev && curr;
              });
            expect(allLessThan).toBeTruthy();

            // we expect that balances before minus balances after equals the contributions
            const reconciled = await contributionsReconcile(
              saleInit,
              buyers,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(reconciled).toBeTruthy();
          }

          // hold your horses again
          await waitForSaleToEnd(contributorConfigs, saleInit, 5);

          // before sealing the sale, check the balance of the distribution token
          // on the refundRecipient address. Then check again to double-check the dust
          // calculation after allocations have been sent
          const recipientBalanceBefore = await getRefundRecipientBalanceOnEth(
            saleInit,
            conductorConfig
          );

          // now seal the sale
          const saleResult = await sealOrAbortSaleOnEth(
            saleInit,
            conductorConfig,
            contributorConfigs
          );
          expect(saleResult.sale.isAborted).toBeTruthy();

          // conductor gets his refund. check that he does
          await claimConductorRefund(saleInit, conductorConfig);

          const recipientBalanceAfter = await getRefundRecipientBalanceOnEth(
            saleInit,
            conductorConfig
          );

          // on a refund, the refund recipient gets the distribution token
          expect(
            recipientBalanceAfter
              .sub(recipientBalanceBefore)
              .eq(saleInit.tokenAmount)
          ).toBeTruthy();

          // now make the buyers whole again. abort and refund, checking their balances after refund
          await abortSaleAtContributors(saleResult, contributorConfigs);

          const buyerBalancesBefore = await getCollateralBalancesOnEth(buyers);

          const claimed: boolean[] = [false, false, false, false, false, false];
          // EXPECT ERROR claim one refund (from first buyer), but error if claimed again
          {
            const buyerIndex = 0;
            claimed[buyerIndex] = await claimOneContributorRefundOnEth(
              saleInit,
              buyers,
              buyerIndex
            );

            let expectedErrorExists = false;
            try {
              await claimOneContributorRefundOnEth(
                saleInit,
                buyers,
                buyerIndex
              );
            } catch (error: any) {
              const errorMsg = error.toString();
              if (errorMsg.endsWith("refund already claimed")) {
                expectedErrorExists = true;
              } else {
                throw Error(error);
              }
            }
            expect(expectedErrorExists).toBeTruthy();
          }

          // claim refunds and check balances
          const refundSuccessful = await claimAllBuyerRefundsOnEth(
            saleInit,
            buyers,
            claimed
          );
          expect(refundSuccessful).toBeTruthy();

          const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);
          const allGreaterThan = buyerBalancesAfter
            .map((balance, index) => {
              return ethers.BigNumber.from(balance).gt(
                buyerBalancesBefore[index]
              );
            })
            .reduce((prev, curr) => {
              return prev && curr;
            });
          expect(allGreaterThan).toBeTruthy();

          // we expect that balances after minus balances before equals the contributions
          const reconciled = await refundsReconcile(
            saleInit,
            buyers,
            buyerBalancesBefore,
            buyerBalancesAfter
          );
          expect(reconciled).toBeTruthy();

          ethProvider.destroy();
          bscProvider.destroy();
          done();
        } catch (e) {
          console.error(e);
          done(
            "An error occurred while trying to Execute Aborted ICCO Sale with Raise Not Met"
          );
        }
      })();
    });
    test("Execute Abort Sale Before Sale Start And Refund Out of Sync Contributors", (done) => {
      (async () => {
        try {
          const ethProvider = new ethers.providers.WebSocketProvider(
            ETH_NODE_URL
          );
          const bscProvider = new ethers.providers.WebSocketProvider(
            BSC_NODE_URL
          );

          // seller
          const contributorConfigs: EthContributorConfig[] = [
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, ethProvider),
              collateralAddress: WETH_ADDRESS,
              conversionRate: "1",
            },
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              conversionRate: "0.2",
            },
          ];

          // one buyer
          const buyers: EthBuyerConfig[] = [
            // native wbnb
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "20",
              tokenIndex: 0,
            },
          ];

          // specific prep so buyers can make contributions from their respective wallets
          const wrapIndices = [0];
          const transferFromIndices = undefined; // no transfers
          const transferToIndices = undefined; // no transfers
          await prepareBuyersForMixedContributionTest(
            buyers,
            wrapIndices,
            transferFromIndices,
            transferToIndices
          );

          // we need to set up all of the accepted tokens
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers,
            DENOMINATION_DECIMALS
          );

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          // make sale token. mint 10 and sell 10%
          const tokenAddress = await deployTokenOnEth(
            ETH_NODE_URL,
            "Icco-Test3",
            "ICCO3",
            ethers.utils.parseUnits("10").toString(),
            conductorConfig.wallet
          );

          const tokenChain = CHAIN_ID_ETH; // needed to check if token is native or not
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const maxRaise = "100";
          const saleDuration = 30; // seconds

          // we need to make sure the distribution token is attested before we consider selling it cross-chain
          await attestSaleToken(
            tokenAddress,
            conductorConfig,
            contributorConfigs
          );

          // get the time
          const saleStart = await makeSaleStartFromLastBlock(
            contributorConfigs
          );

          // the token being sold is on eth
          // which means it has the same local token address
          const localTokenAddress = tokenAddress;

          // create fake solana ATA
          const solanaTokenAccount = nativeToUint8Array(
            localTokenAddress,
            CHAIN_ID_ETH // will be CHAIN_ID_SOLANA with a real token
          );

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            localTokenAddress,
            tokenAddress,
            tokenChain,
            tokenAmount,
            minRaise,
            maxRaise,
            saleStart + 20, // 20 second duration
            saleDuration,
            acceptedTokens,
            solanaTokenAccount
          );
          console.log("Parsed Sale Init:", saleInit);

          // abort the sale in the conductor and verify getters
          let abortEarlyReceipt: ethers.ContractReceipt | undefined = undefined;
          {
            // sale info before aborting
            const conductorSaleBefore = await getSaleFromConductorOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              conductorConfig.wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleBefore.isAborted).toBeFalsy();

            const conductorSale = await getSaleFromConductorOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              conductorConfig.wallet.provider,
              saleInit.saleId
            );

            // confirm that the sale initiator is set to the conductorConfig wallet
            expect(
              conductorSale.initiator === conductorConfig.wallet.address
            ).toBeTruthy();

            // abort the sale early in the conductor
            abortEarlyReceipt = await abortSaleEarlyAtConductor(
              saleInit,
              conductorConfig
            );

            // sale info after aborting
            const conductorSaleAfter = await getSaleFromConductorOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              conductorConfig.wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleAfter.isAborted).toBeTruthy();
          }

          // make a contribution before the early abort VAA
          // is sent to the contributors, and check balances
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // wait until sale starts to contribute
            await waitForSaleToStart(contributorConfigs, saleInit, 2);

            // submit one buyer's contribution before
            const contributionSuccessful = await secureContributeAllTokensOnEth(
              saleInit,
              buyers,
              tokenAddress, // sale token
              ETH_NODE_URL
            );
            expect(contributionSuccessful).toBeTruthy();

            // check balances after contributing
            const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);

            // we expect that balances before minus balances after equals the contributions
            const reconciled = await contributionsReconcile(
              saleInit,
              buyers,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(reconciled).toBeTruthy();
          }

          // abort the sale for contributors and verify getters
          {
            // get sale info before aborting
            const conductorSaleEthBefore = await getSaleFromContributorOnEth(
              TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_ETH)!,
              contributorConfigs[0].wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleEthBefore.isAborted).toBeFalsy();

            const conductorSaleBscBefore = await getSaleFromContributorOnEth(
              TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_BSC)!,
              contributorConfigs[1].wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleBscBefore.isAborted).toBeFalsy();

            // abort the sale for all contributors
            await abortSaleEarlyAtContributors(
              abortEarlyReceipt,
              contributorConfigs,
              conductorConfig
            );

            // sale info after aborting
            const conductorSaleEthAfter = await getSaleFromContributorOnEth(
              TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_ETH)!,
              contributorConfigs[0].wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleEthAfter.isAborted).toBeTruthy();

            const conductorSaleBscAfter = await getSaleFromContributorOnEth(
              TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_BSC)!,
              contributorConfigs[1].wallet.provider,
              saleInit.saleId
            );
            expect(conductorSaleBscAfter.isAborted).toBeTruthy();
          }

          // try to contribute after the sale has been aborted
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            let expectedErrorExists = false;
            try {
              // try to contribute funds and expect a revert
              await secureContributeAllTokensOnEth(
                saleInit,
                buyers,
                tokenAddress, // sale token,
                ETH_NODE_URL
              );
            } catch (error) {
              const errorMsg: string = error.error.toString();
              if (errorMsg.endsWith("sale was aborted")) {
                expectedErrorExists = true;
              }
              expect(expectedErrorExists).toBeTruthy();
            }

            // check balances after contributing
            const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);

            // confirm that balances haven't changed
            expect(buyerBalancesBefore[0]).toBe(buyerBalancesAfter[0]);
          }

          // try to attest a contribution after the sale was aborted
          {
            // wait until sale ends to attempt attesting contributions
            await waitForSaleToEnd(contributorConfigs, saleInit, 3);

            let expectedErrorExists = false;
            try {
              // try to attest contributions and expect a revert
              await attestContributionsOnEth(
                TOKEN_SALE_CONTRIBUTOR_ADDRESSES.get(CHAIN_ID_ETH)!,
                saleInit.saleId,
                contributorConfigs[0].wallet
              );
            } catch (error: any) {
              const errorMsg: string = error.error.toString();
              if (errorMsg.endsWith("already sealed / aborted")) {
                expectedErrorExists = true;
              }
              expect(expectedErrorExists).toBeTruthy();
            }
          }

          // try to seal a sale on the conductor after aborting
          {
            let expectedErrorExists = false;
            try {
              // try to seal the sale and expect a revert
              await sealSaleOnEth(
                ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
                saleInit.saleId,
                conductorConfig.wallet
              );
            } catch (error: any) {
              const errorMsg: string = error.toString();
              if (errorMsg.endsWith("already sealed / aborted")) {
                expectedErrorExists = true;
              }
              expect(expectedErrorExists).toBeTruthy();
            }
          }

          // refund the conductor and check balances
          {
            const recipientBalanceBefore = await getRefundRecipientBalanceOnEth(
              saleInit,
              conductorConfig
            );

            // conductor gets his refund. check that he does
            await claimConductorRefund(saleInit, conductorConfig);

            const recipientBalanceAfter = await getRefundRecipientBalanceOnEth(
              saleInit,
              conductorConfig
            );

            // on a refund, the refund recipient gets the distribution token
            expect(
              recipientBalanceAfter
                .sub(recipientBalanceBefore)
                .eq(saleInit.tokenAmount)
            ).toBeTruthy();
          }

          // fetch refunds for any contributors that snuck their contribution in before
          // the sale was aborted on the contributor side, and check balances
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // claim refunds and check balances
            const claimed: boolean[] = [false];
            const refundSuccessful = await claimAllBuyerRefundsOnEth(
              saleInit,
              buyers,
              claimed
            );
            expect(refundSuccessful).toBeTruthy();

            const buyerBalancesAfter = await getCollateralBalancesOnEth(buyers);
            const allGreaterThan = buyerBalancesAfter
              .map((balance, index) => {
                return ethers.BigNumber.from(balance).gt(
                  buyerBalancesBefore[index]
                );
              })
              .reduce((prev, curr) => {
                return prev && curr;
              });
            expect(allGreaterThan).toBeTruthy();

            // we expect that balances after minus balances before equals the contributions
            const reconciled = await refundsReconcile(
              saleInit,
              buyers,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(reconciled).toBeTruthy();
          }

          ethProvider.destroy();
          bscProvider.destroy();
          done();
        } catch (e) {
          console.error(e);
          done(
            "An error occurred while trying to Execute Successful ICCO Sale with Late Contributor"
          );
        }
      })();
    });
  });
});
