import { describe, expect, jest, test } from "@jest/globals";
import { ethers } from "ethers";
import {
  CHAIN_ID_BSC,
  CHAIN_ID_ETH,
  nativeToHexString,
  redeemOnEth,
  setDefaultWasm,
} from "../..";
import { getContributorContractAsHexStringOnEth } from "../getters";
import {
  BSC_NODE_URL,
  ETH_NODE_URL,
  ETH_PRIVATE_KEY1,
  ETH_PRIVATE_KEY2,
  ETH_PRIVATE_KEY3,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
  TEST_ERC20,
  WBNB_ADDRESS,
  WETH_ADDRESS,
} from "./consts";
import {
  EthBuyerConfig,
  EthContributorConfig,
  createSaleOnEthAndInit,
  waitForSaleToEnd,
  waitForSaleToStart,
  makeAcceptedTokensFromConfigs,
  sealOrAbortSaleOnEth,
  contributeAllTokensOnEth,
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
  redeemCrossChainAllocations,
  attestSaleToken,
  getWrappedCollateral,
  getRefundRecipientBalanceOnEth,
  //redeemOneAllocation,
  claimOneContributorRefundOnEth,
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

          expect(
            await getContributorContractAsHexStringOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              provider,
              CHAIN_ID_ETH
            )
          ).toEqual(
            nativeToHexString(ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS, CHAIN_ID_ETH)
          );
          expect(
            await getContributorContractAsHexStringOnEth(
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
              provider,
              CHAIN_ID_BSC
            )
          ).toEqual(
            nativeToHexString(ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS, CHAIN_ID_BSC)
          );

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
            },
            // native wbnb
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "20",
            },
            // wormhole wrapped bnb
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, ethProvider),
              collateralAddress: wormholeWrapped.wbnbOnEth,
              contribution: "3",
            },

            // wormhole wrapped weth
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, bscProvider),
              collateralAddress: wormholeWrapped.wethOnBsc,
              contribution: "5",
            },
          ];

          // specific prep so buyers can make contributions from their respective wallets
          await prepareBuyersForMixedContributionTest(buyers);

          // we need to set up all of the accepted tokens (natives plus their wrapped versions)
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers
          );

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          const tokenAddress = TEST_ERC20;
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const saleDuration = 60; // seconds

          // get the time
          const saleStart = await makeSaleStartFromLastBlock(
            contributorConfigs
          );

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            tokenAddress,
            tokenAmount,
            minRaise,
            saleStart,
            saleDuration,
            acceptedTokens
          );

          // balance check
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // hold your horses
            await waitForSaleToStart(contributorConfigs, saleInit, 5);

            // finally buyers contribute
            const contributionSuccessful = await contributeAllTokensOnEth(
              saleInit,
              buyers
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
            await prepareBuyersForMixedContributionTest(buyers);

            let expectedErrorExists = false;
            try {
              // buyers contribute
              const contributionSuccessful = await contributeAllTokensOnEth(
                saleInit,
                buyers
              );
            } catch (error) {
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
          console.info("sealOrAbortSaleOnEth");
          const saleResult = await sealOrAbortSaleOnEth(
            saleInit,
            conductorConfig,
            contributorConfigs
          );
          expect(saleResult.sale.isSealed).toBeTruthy();

          console.info("saleResult", saleResult);

          // we need to make sure the distribution token is attested before we consider seling it cross-chain
          await attestSaleToken(
            tokenAddress,
            conductorConfig,
            contributorConfigs
          );

          // EXPECT ERROR: should not be able to seal the sale before allocations have been send to contributors
          console.info("expected error: sale token balance must be non-zero");
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
            } catch (error) {
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
          console.info("expected error: insufficient sale token balance");
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
            } catch (error) {
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
          console.info("redeemCrossChainAllocations");
          {
            const receipts = await redeemCrossChainAllocations(
              saleResult,
              contributorConfigs
            );
          }

          console.info("sealSaleAtContributors");
          // seal the sale at the contributors, then check balances
          const saleSealed = await sealSaleAtContributors(
            saleInit,
            saleResult,
            contributorConfigs
          );

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

          // balance check of distributed token to buyers
          {
            const buyerBalancesBefore = await getAllocationBalancesOnEth(
              saleInit,
              buyers
            );

            const claimsSuccessful = await claimAllAllocationsOnEth(
              buyers,
              saleSealed
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

            const allocationsReconciled = allocationsReconcile(
              saleSealed,
              buyerBalancesBefore,
              buyerBalancesAfter
            );
            expect(allocationsReconciled).toBeTruthy();
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
            },
            // native wbnb
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, bscProvider),
              collateralAddress: WBNB_ADDRESS,
              contribution: "15",
            },
            // wormhole wrapped bnb
            {
              chainId: CHAIN_ID_ETH,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY3, ethProvider),
              collateralAddress: wormholeWrapped.wbnbOnEth,
              contribution: "5",
            },
            // wormhole wrapped weth
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, bscProvider),
              collateralAddress: wormholeWrapped.wethOnBsc,
              contribution: "2.99999999",
            },
          ];

          // specific prep so buyers can make contributions from their respective wallets
          await prepareBuyersForMixedContributionTest(buyers);

          // we need to set up all of the accepted tokens (natives plus their wrapped versions)
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers
          );

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          const tokenAddress = TEST_ERC20;
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const saleDuration = 60; // seconds

          // get the time
          const saleStart = await makeSaleStartFromLastBlock(
            contributorConfigs
          );

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            tokenAddress,
            tokenAmount,
            minRaise,
            saleStart,
            saleDuration,
            acceptedTokens
          );

          // balance check
          {
            const buyerBalancesBefore = await getCollateralBalancesOnEth(
              buyers
            );

            // hold your horses
            await waitForSaleToStart(contributorConfigs, saleInit, 5);

            // finally buyers contribute
            const contributionSuccessful = await contributeAllTokensOnEth(
              saleInit,
              buyers
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

          const claimed: boolean[] = [false, false, false, false];
          // EPXECT ERROR: claim one refund (from first buyer), but error if claimed again
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
            } catch (error) {
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
            buyers,
            buyerBalancesBefore,
            buyerBalancesAfter
          );
          expect(reconciled).toBeTruthy();

          // TODO: try to refund again. expect error when failed

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
    test("Execute Abort Sale Before Sale Start", (done) => {
      (async () => {
        try {
          const ethProvider = new ethers.providers.WebSocketProvider(
            ETH_NODE_URL
          );
          const bscProvider = new ethers.providers.WebSocketProvider(
            BSC_NODE_URL
          );

          // TODO

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
