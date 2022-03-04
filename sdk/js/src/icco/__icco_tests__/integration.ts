import { describe, expect, jest, test } from "@jest/globals";
import { ethers } from "ethers";
import {
  ChainId,
  CHAIN_ID_BSC,
  CHAIN_ID_ETH,
  ERC20__factory,
  hexToNativeString,
  nativeToHexString,
  setDefaultWasm,
} from "../..";
import { checkRegisteredContributor } from "../contributorContracts";
import { wrapEth } from "../misc";
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
  BuyerConfig,
  ContributorConfig,
  createSaleOnEthAndInit,
  transferFromEthNativeAndRedeemOnEth,
  createWrappedIfUndefined,
  waitForSaleToEnd,
  waitForSaleToStart,
  makeAcceptedTokensFromConfigs,
  sealOrAbortSaleOnEth,
  contributeAllTokensOnEth,
  getCollateralBalancesOnEth,
  claimAllAllocationsOnEth,
  getAllocationBalancesOnEth,
  contributionsReconcile,
  attestOnEthAndCreateWrappedOnEth,
  allocationsReconcile,
  getErc20Balance,
} from "./helpers";

jest.setTimeout(300000);

setDefaultWasm("node");

// TODO: setup keypair and provider/signer before, destroy provider after
// TODO: make the repeatable (can't attest an already attested token)

describe("Integration Tests", () => {
  describe("Conduct ICCO on Ethereum", () => {
    test("Check Registered Contributors on Ethereum Conductor", (done) => {
      (async () => {
        try {
          // TODO: double-check this
          const provider = new ethers.providers.WebSocketProvider(BSC_NODE_URL);

          expect(
            await checkRegisteredContributor(
              provider,
              CHAIN_ID_ETH,
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS
            )
          ).toEqual(
            "0x" +
              nativeToHexString(
                ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
                CHAIN_ID_ETH
              )
          );
          expect(
            await checkRegisteredContributor(
              provider,
              CHAIN_ID_BSC,
              ETH_TOKEN_SALE_CONDUCTOR_ADDRESS
            )
          ).toEqual(
            "0x" +
              nativeToHexString(
                ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
                CHAIN_ID_BSC
              )
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
          const contributorConfigs: ContributorConfig[] = [
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

          const [wormholeWethOnBscAddress, wormholeWbnbOnEthAddress] =
            await Promise.all([
              createWrappedIfUndefined(
                contributorConfigs[0],
                contributorConfigs[1]
              ),
              createWrappedIfUndefined(
                contributorConfigs[1],
                contributorConfigs[0]
              ),
            ]);

          // pk2 := weth contributors, pk3 := wbnb contributors
          const buyers: BuyerConfig[] = [
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
              collateralAddress: wormholeWbnbOnEthAddress,
              contribution: "3",
            },

            // wormhole wrapped weth
            {
              chainId: CHAIN_ID_BSC,
              wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, bscProvider),
              collateralAddress: wormholeWethOnBscAddress,
              contribution: "5",
            },
          ];

          // we need to set up all of the accepted tokens (natives plus their wrapped versions)
          const acceptedTokens = await makeAcceptedTokensFromConfigs(
            contributorConfigs,
            buyers
          );

          // prepare for the contribution
          {
            await Promise.all([
              wrapEth(
                buyers[0].wallet,
                buyers[0].collateralAddress,
                buyers[0].contribution
              ),

              wrapEth(
                buyers[1].wallet,
                buyers[1].collateralAddress,
                buyers[1].contribution
              ),
            ]);
          }

          // transfer eth/bnb to other wallets
          {
            const ethSender = buyers[0];
            const ethReceiver = buyers[3];

            const bnbSender = buyers[1];
            const bnbReceiver = buyers[2];

            const receipts = await Promise.all([
              transferFromEthNativeAndRedeemOnEth(
                ethSender.wallet,
                ethSender.chainId,
                ethReceiver.contribution,
                ethReceiver.wallet,
                ethReceiver.chainId
              ),

              transferFromEthNativeAndRedeemOnEth(
                bnbSender.wallet,
                bnbSender.chainId,
                bnbReceiver.contribution,
                bnbReceiver.wallet,
                bnbReceiver.chainId
              ),
            ]);
          }

          // conductor lives in CHAIN_ID_ETH
          const conductorConfig = contributorConfigs[0];

          const tokenAddress = TEST_ERC20;
          const tokenAmount = "1";
          const minRaise = "10"; // eth units
          const saleDuration = 60; // seconds

          // we need to make sure the distribution token is attested before we consider seling it cross-chain
          for (const config of contributorConfigs) {
            if (config.chainId === conductorConfig.chainId) {
              continue;
            }
            const wrapped = await attestOnEthAndCreateWrappedOnEth(
              conductorConfig.wallet,
              conductorConfig.chainId,
              tokenAddress,
              config.wallet
            );
          }

          const saleInit = await createSaleOnEthAndInit(
            conductorConfig,
            contributorConfigs,
            tokenAddress,
            tokenAmount,
            minRaise,
            saleDuration,
            acceptedTokens
          );

          console.info("saleInit", saleInit);

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
          const refundRecipient =
            hexToNativeString(
              saleInit.refundRecipient,
              saleInit.tokenChain as ChainId
            ) || "";

          const recipientBalanceBefore = await getErc20Balance(
            ethProvider,
            tokenAddress,
            refundRecipient
          );

          // now seal the sale
          const saleResult = await sealOrAbortSaleOnEth(
            conductorConfig,
            contributorConfigs,
            saleInit
          );
          if (saleResult.saleSealed === undefined) {
            throw Error("saleSealed is undefined");
          }
          expect(saleResult.sealed).toBeTruthy();

          const saleSealed = saleResult.saleSealed;
          console.info("saleSealed", saleSealed);

          const recipientBalanceAfter = await getErc20Balance(
            ethProvider,
            tokenAddress,
            refundRecipient
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
            "An error occurred while trying to Create Successful ICCO Sale With Native Contributions"
          );
        }
      })();
    });
    test("Execute Failed ICCO Sale with Raise Not Met", (done) => {
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
            "An error occurred while trying to execute failed ICCO Sale with Raise Not Met"
          );
        }
      })();
    });
    test("Execute Successful ICCO Sale with Late Contributor", (done) => {
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
