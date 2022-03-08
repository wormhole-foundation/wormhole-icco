import { describe, expect, it } from "@jest/globals";
import { ethers } from "ethers";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import { ERC20__factory } from "../../ethers-contracts";
import {
  ChainId,
  hexToUint8Array,
  nativeToHexString,
  getSignedVAAWithRetry,
  getEmitterAddressEth,
  getForeignAssetEth,
  parseSequencesFromLogEth,
  redeemOnEth,
  transferFromEthNative,
  attestFromEth,
  createWrappedOnEth,
  getOriginalAssetEth,
  uint8ArrayToHex,
  hexToNativeString,
} from "../..";
import {
  AcceptedToken,
  SaleInit,
  SaleSealed,
  attestContributionsOnEth,
  initSaleOnEth,
  claimAllocationOnEth,
  claimConductorRefundOnEth,
  claimContributorRefundOnEth,
  collectContributionsOnEth,
  createSaleOnEth,
  contributeOnEth,
  extractVaaPayload,
  getAllocationIsClaimedOnEth,
  getCurrentBlock,
  getErc20Balance,
  getSaleContribution,
  getSaleFromConductorOnEth,
  getSaleFromContributorOnEth,
  makeAcceptedToken,
  makeAcceptedWrappedTokenEth,
  nativeToUint8Array,
  parseSaleInit,
  parseSaleSealed,
  refundIsClaimedOnEth,
  sealSaleOnEth,
  saleSealedOnEth,
  sleepFor,
  wrapEth,
  saleAbortedOnEth,
  getTargetChainIdFromTransferVaa,
} from "..";
import {
  ETH_CORE_BRIDGE_ADDRESS,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
  WORMHOLE_RPC_HOSTS,
} from "./consts";

interface EthConfig {
  chainId: ChainId;
  wallet: ethers.Wallet;
}

export interface EthConductorConfig extends EthConfig {}

export interface EthContributorConfig extends EthConfig {
  collateralAddress: string;
  conversionRate: string;
}

export interface EthBuyerConfig extends EthConfig {
  collateralAddress: string;
  contribution: string;
}

enum BalanceChange {
  Increase = 1,
  Decrease,
}

// TODO: add terra and solana handling to this (doing it serially here to make it easier to adapt)
export async function makeAcceptedTokensFromConfigs(
  configs: EthContributorConfig[],
  potentialBuyers: EthBuyerConfig[]
): Promise<AcceptedToken[]> {
  const acceptedTokens: AcceptedToken[] = [];

  for (const buyer of potentialBuyers) {
    const info = await getOriginalAssetEth(
      ETH_TOKEN_BRIDGE_ADDRESS,
      buyer.wallet,
      buyer.collateralAddress,
      buyer.chainId
    );

    const contributor = configs.find((config) => {
      return (
        config.chainId === info.chainId &&
        nativeToHexString(config.collateralAddress, config.chainId) ==
          uint8ArrayToHex(info.assetAddress)
      );
    });
    if (contributor === undefined) {
      throw Error("cannot find native token in contributor config");
    }

    acceptedTokens.push(
      makeAcceptedToken(
        buyer.chainId,
        buyer.collateralAddress,
        contributor.conversionRate
      )
    );
  }
  return acceptedTokens;
}

export async function prepareBuyersForMixedContributionTest(
  buyers: EthBuyerConfig[]
): Promise<void> {
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

  return;
}

export interface WormholeWrappedAddresses {
  wethOnBsc: string;
  wbnbOnEth: string;
}

export async function getWrappedCollateral(
  configs: EthContributorConfig[]
): Promise<WormholeWrappedAddresses> {
  const [wethOnBsc, wbnbOnEth] = await Promise.all([
    createWrappedIfUndefined(configs[0], configs[1]),
    createWrappedIfUndefined(configs[1], configs[0]),
  ]);

  return {
    wethOnBsc: wethOnBsc,
    wbnbOnEth: wbnbOnEth,
  };
}

export async function attestSaleToken(
  tokenAddress: string,
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[]
): Promise<void> {
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
  return;
}

export function parseSequencesFromEthReceipt(
  receipt: ethers.ContractReceipt
): string[] {
  return parseSequencesFromLogEth(receipt, ETH_CORE_BRIDGE_ADDRESS);
}

export async function getSignedVaaFromSequence(
  chainId: ChainId,
  emitterAddress: string,
  sequence: string
): Promise<Uint8Array> {
  const result = await getSignedVAAWithRetry(
    WORMHOLE_RPC_HOSTS,
    chainId,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );
  return result.vaaBytes;
}

export async function getSignedVaasFromSequences(
  chainId: ChainId,
  emitterAddress: string,
  sequences: string[]
): Promise<Uint8Array[]> {
  return Promise.all(
    sequences.map(async (sequence) => {
      return getSignedVaaFromSequence(chainId, emitterAddress, sequence);
    })
  );
}

export async function getSignedVaaFromReceiptOnEth(
  chainId: ChainId,
  contractAddress: string,
  receipt: ethers.ContractReceipt
): Promise<Uint8Array> {
  const sequences = parseSequencesFromEthReceipt(receipt);
  if (sequences.length !== 1) {
    throw Error("more than one sequence found in log");
  }

  return getSignedVaaFromSequence(
    chainId,
    getEmitterAddressEth(contractAddress),
    sequences[0]
  );
}

export async function getWrappedAssetEth(
  srcChainId: ChainId,
  srcTokenAddress: string,
  dstProvider: ethers.providers.Provider
): Promise<string> {
  const encodedAddress = nativeToUint8Array(srcTokenAddress, srcChainId);
  const wrappedAddress = await getForeignAssetEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    dstProvider,
    srcChainId,
    encodedAddress
  );
  return wrappedAddress || "";
}

export async function attestOnEthAndCreateWrappedOnEth(
  srcWallet: ethers.Wallet,
  srcChainId: ChainId,
  srcTokenAddress: string,
  dstWallet: ethers.Wallet
) {
  const wrappedAddress = await getWrappedAssetEth(
    srcChainId,
    srcTokenAddress,
    dstWallet.provider
  );

  if (wrappedAddress !== ethers.constants.AddressZero) {
    return wrappedAddress;
  }

  // need to attest and post to dst
  const receipt = await attestFromEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    srcWallet,
    srcTokenAddress
  );
  const signedVaa = await getSignedVaaFromReceiptOnEth(
    srcChainId,
    ETH_TOKEN_BRIDGE_ADDRESS,
    receipt
  );

  await createWrappedOnEth(ETH_TOKEN_BRIDGE_ADDRESS, dstWallet, signedVaa);

  return getWrappedAssetEth(srcChainId, srcTokenAddress, dstWallet.provider);
}

export async function createWrappedIfUndefined(
  srcSeller: EthContributorConfig,
  dstSeller: EthContributorConfig
): Promise<string> {
  return attestOnEthAndCreateWrappedOnEth(
    srcSeller.wallet,
    srcSeller.chainId,
    srcSeller.collateralAddress,
    dstSeller.wallet
  );
}

export async function transferFromEthNativeAndRedeemOnEth(
  srcWallet: ethers.Wallet,
  srcChainId: ChainId,
  amount: string,
  dstWallet: ethers.Wallet,
  dstChainId: ChainId
): Promise<ethers.ContractReceipt> {
  const transferReceipt = await transferFromEthNative(
    ETH_TOKEN_BRIDGE_ADDRESS,
    srcWallet,
    ethers.utils.parseUnits(amount),
    dstChainId,
    nativeToUint8Array(dstWallet.address, dstChainId)
  );

  const signedVaa = await getSignedVaaFromReceiptOnEth(
    srcChainId,
    ETH_TOKEN_BRIDGE_ADDRESS,
    transferReceipt
  );

  return redeemOnEth(ETH_TOKEN_BRIDGE_ADDRESS, dstWallet, signedVaa);
}

export async function createSaleOnEthAndGetVaa(
  seller: ethers.Wallet,
  chainId: ChainId,
  tokenAddress: string,
  amount: ethers.BigNumberish,
  minRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  acceptedTokens: AcceptedToken[]
): Promise<Uint8Array> {
  // approve
  /*
  {
    const tx = await token.approve(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS, amount);
    const receipt = await tx.wait();
  }
  */

  // create
  const receipt = await createSaleOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    tokenAddress,
    amount,
    minRaise,
    saleStart,
    saleEnd,
    acceptedTokens,
    seller.address,
    seller.address,
    seller
  );

  return getSignedVaaFromReceiptOnEth(
    chainId,
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    receipt
  );
}

export async function getCollateralBalancesOnEth(
  buyers: EthBuyerConfig[]
): Promise<ethers.BigNumberish[]> {
  return Promise.all(
    buyers.map(async (config): Promise<ethers.BigNumberish> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      const balance = await token.balanceOf(config.wallet.address);
      return balance.toString();
    })
  );
}

export async function contributeAllTokensOnEth(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[]
): Promise<boolean> {
  const saleId = saleInit.saleId;

  const decimals = await Promise.all(
    buyers.map(async (config): Promise<number> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      return token.decimals();
    })
  );

  // contribute
  {
    const receipts = await Promise.all(
      buyers.map(
        async (config, tokenIndex): Promise<ethers.ContractReceipt> => {
          return contributeOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            saleId,
            tokenIndex,
            ethers.utils.parseUnits(config.contribution, decimals[tokenIndex]),
            config.wallet
          );
        }
      )
    );
  }

  // check contributions
  const contributions = await Promise.all(
    buyers.map(async (config, tokenIndex): Promise<ethers.BigNumber> => {
      return await getSaleContribution(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        tokenIndex,
        config.wallet
      );
    })
  );

  return buyers
    .map((config, tokenIndex): boolean => {
      return ethers.utils
        .parseUnits(config.contribution, decimals[tokenIndex])
        .eq(contributions[tokenIndex]);
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function getLatestBlockTime(
  configs: EthContributorConfig[]
): Promise<number> {
  const currentBlocks = await Promise.all(
    configs.map((config): Promise<ethers.providers.Block> => {
      return getCurrentBlock(config.wallet.provider);
    })
  );

  return currentBlocks
    .map((block): number => {
      return block.timestamp;
    })
    .reduce((prev, curr): number => {
      return Math.max(prev, curr);
    });
}

export async function makeSaleStartFromLastBlock(
  configs: EthContributorConfig[]
): Promise<number> {
  const timeOffset = 5; // seconds (arbitrarily short amount of time to delay sale)
  const lastBlockTime = await getLatestBlockTime(configs);
  return timeOffset + lastBlockTime;
}

export async function createSaleOnEthAndInit(
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[],
  saleTokenAddress: string,
  tokenAmount: string,
  minRaise: string,
  saleStart: number,
  saleDuration: number,
  acceptedTokens: AcceptedToken[]
): Promise<SaleInit> {
  const tokenOffered = ERC20__factory.connect(
    saleTokenAddress,
    conductorConfig.wallet
  );
  const decimals = await tokenOffered.decimals();

  const saleEnd = saleStart + saleDuration;

  const saleInitVaa = await createSaleOnEthAndGetVaa(
    conductorConfig.wallet,
    conductorConfig.chainId,
    saleTokenAddress,
    ethers.utils.parseUnits(tokenAmount, decimals),
    ethers.utils.parseUnits(minRaise),
    saleStart,
    saleEnd,
    acceptedTokens
  );

  // parse vaa for ICCOStruct
  const saleInit = await parseSaleInit(saleInitVaa);
  console.info("saleInit", saleInit);

  {
    const receipts = await Promise.all(
      contributorConfigs.map(
        async (config): Promise<ethers.ContractReceipt> => {
          return initSaleOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            config.wallet,
            saleInitVaa
          );
        }
      )
    );
  }

  return saleInit;
}

export async function waitForSaleToStart(
  contributorConfigs: EthContributorConfig[],
  saleInit: SaleInit,
  extraTime: number // seconds
): Promise<void> {
  const timeNow = await getLatestBlockTime(contributorConfigs);
  const timeLeftForSale = Number(saleInit.saleStart) - timeNow;
  if (timeLeftForSale > 0) {
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

export async function waitForSaleToEnd(
  contributorConfigs: EthContributorConfig[],
  saleInit: SaleInit,
  extraTime: number // seconds
): Promise<void> {
  const timeNow = await getLatestBlockTime(contributorConfigs);
  const timeLeftForSale = Number(saleInit.saleEnd) - timeNow;
  if (timeLeftForSale > 0) {
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

/*
interface IccoSaleResult {
  saleSealed: SaleSealed | undefined;
  sealed: boolean;
  aborted: boolean;
}
*/

interface SealSaleResult {
  sealed: boolean;
  aborted: boolean;
  conductorChainId: ChainId;
  bridgeSequences: string[];
  conductorSequence: string;
}

export async function attestAndCollectContributions(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[]
): Promise<void> {
  const saleId = saleInit.saleId;

  const signedVaas = await Promise.all(
    contributorConfigs.map(async (config): Promise<Uint8Array> => {
      const receipt = await attestContributionsOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        config.wallet
      );

      return getSignedVaaFromReceiptOnEth(
        config.chainId,
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        receipt
      );
    })
  );

  {
    const receipts = await collectContributionsOnEth(
      ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
      conductorConfig.wallet,
      signedVaas
    );
  }
  return;
}

export async function sealOrAbortSaleOnEth(
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[],
  saleInit: SaleInit
): Promise<SealSaleResult> {
  const saleId = saleInit.saleId;

  // attest contributions and use vaas to seal sale
  {
    const signedVaas = await Promise.all(
      contributorConfigs.map(async (config): Promise<Uint8Array> => {
        const receipt = await attestContributionsOnEth(
          ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
          saleId,
          config.wallet
        );

        return getSignedVaaFromReceiptOnEth(
          config.chainId,
          ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
          receipt
        );
      })
    );

    // need to do serially do to nonce issues
    await collectContributionsOnEth(
      ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
      conductorConfig.wallet,
      signedVaas
    );
  }

  const sealReceipt = await sealSaleOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    conductorConfig.wallet,
    saleId
  );

  // we have token transfers and saleSealed vaas. first grab
  // the last vaa sent, which is the saleSealed message
  const sequences = parseSequencesFromEthReceipt(sealReceipt);
  const conductorSequence = sequences.pop();
  if (conductorSequence === undefined) {
    throw Error("no sequences found");
  }

  // what is the result?
  const sale = await getSaleFromConductorOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    conductorConfig.wallet.provider,
    saleId
  );

  return {
    sealed: sale.isSealed,
    aborted: sale.isAborted,
    conductorChainId: conductorConfig.chainId,
    bridgeSequences: sequences,
    conductorSequence: conductorSequence,
  };
}

export async function sealSaleAtContributors(
  sealSaleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
) {
  if (!sealSaleResult.sealed) {
    throw Error("sale was not sealed");
  }

  const signedVaa = await getSignedVaaFromSequence(
    sealSaleResult.conductorChainId,
    getEmitterAddressEth(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS),
    sealSaleResult.conductorSequence
  );

  const saleSealed = await parseSaleSealed(signedVaa);
  console.info("saleSealed", saleSealed);

  {
    // set sale sealed for each contributor
    const receipts = await Promise.all(
      contributorConfigs.map(
        async (config): Promise<ethers.ContractReceipt> => {
          return saleSealedOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            signedVaa,
            config.wallet
          );
        }
      )
    );
  }

  return saleSealed;
}

export async function abortSaleAtContributors(
  sealSaleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
) {
  const signedVaa = await getSignedVaaFromSequence(
    sealSaleResult.conductorChainId,
    getEmitterAddressEth(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS),
    sealSaleResult.conductorSequence
  );

  {
    const receipts = await Promise.all(
      contributorConfigs.map(
        async (config): Promise<ethers.ContractReceipt> => {
          return saleAbortedOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            signedVaa,
            config.wallet
          );
        }
      )
    );
  }

  return;
}

export async function claimConductorRefund(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig
): Promise<ethers.ContractReceipt> {
  return claimConductorRefundOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    saleInit.saleId,
    conductorConfig.wallet
  );
}

export function balanceChangeReconciles(
  before: ethers.BigNumberish,
  after: ethers.BigNumberish,
  direction: BalanceChange,
  change: ethers.BigNumberish
): boolean {
  const balanceBefore = ethers.BigNumber.from(before);
  const balanceAfter = ethers.BigNumber.from(after);
  const balanceChange = ethers.BigNumber.from(change);

  if (direction === BalanceChange.Increase) {
    return (
      balanceBefore.lte(balanceAfter) &&
      balanceAfter.sub(balanceBefore).eq(balanceChange)
    );
  }

  return (
    balanceBefore.gte(balanceAfter) &&
    balanceBefore.sub(balanceAfter).eq(balanceChange)
  );
}

export async function contributionsReconcile(
  buyers: EthBuyerConfig[],
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): Promise<boolean> {
  const decimals = await Promise.all(
    buyers.map(async (config): Promise<number> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      return token.decimals();
    })
  );

  return buyers
    .map((config, index): boolean => {
      return balanceChangeReconciles(
        before[index],
        after[index],
        BalanceChange.Decrease,
        ethers.utils.parseUnits(config.contribution, decimals[index]).toString()
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function refundsReconcile(
  buyers: EthBuyerConfig[],
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): Promise<boolean> {
  const decimals = await Promise.all(
    buyers.map(async (config): Promise<number> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      return token.decimals();
    })
  );

  return buyers
    .map((config, index): boolean => {
      return balanceChangeReconciles(
        before[index],
        after[index],
        BalanceChange.Increase,
        ethers.utils.parseUnits(config.contribution, decimals[index]).toString()
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function claimAllAllocationsOnEth(
  buyers: EthBuyerConfig[],
  saleSealed: SaleSealed
): Promise<boolean> {
  const saleId = saleSealed.saleId;

  const isClaimed = await Promise.all(
    buyers.map(async (config, tokenIndex): Promise<boolean> => {
      const wallet = config.wallet;

      const receipt = await claimAllocationOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        tokenIndex,
        wallet
      );

      return getAllocationIsClaimedOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        wallet.provider,
        saleId,
        tokenIndex,
        wallet.address
      );
    })
  );

  return isClaimed.reduce((prev, curr): boolean => {
    return prev && curr;
  });
}

export async function getAllocationBalancesOnEth(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[]
): Promise<ethers.BigNumberish[]> {
  const chainId = saleInit.tokenChain as ChainId;
  const encoded = hexToUint8Array(saleInit.tokenAddress);

  const allocatedTokenAddresses = await Promise.all(
    buyers.map(async (config): Promise<string> => {
      if (config.chainId === chainId) {
        return hexToNativeString(saleInit.tokenAddress, chainId) || "";
      }
      const wrappedAddress = await getForeignAssetEth(
        ETH_TOKEN_BRIDGE_ADDRESS,
        config.wallet,
        chainId,
        encoded
      );
      return wrappedAddress || "";
    })
  );

  // check for nulls
  for (const address of allocatedTokenAddresses) {
    if (address === "" || address === ethers.constants.AddressZero) {
      throw Error("address is null");
    }
  }

  return Promise.all(
    buyers.map(async (config, index): Promise<ethers.BigNumberish> => {
      const wallet = config.wallet;
      const tokenAddress = allocatedTokenAddresses[index];
      const balance = await getErc20Balance(
        wallet.provider,
        tokenAddress,
        wallet.address
      );
      return balance.toString();
    })
  );
}

export function allocationsReconcile(
  saleSealed: SaleSealed,
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): boolean {
  const allocations = saleSealed.allocations;
  return allocations
    .map((item, tokenIndex): boolean => {
      return balanceChangeReconciles(
        before[tokenIndex],
        after[tokenIndex],
        BalanceChange.Increase,
        item.allocation
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function claimAllBuyerRefundsOnEth(
  saleId: ethers.BigNumberish,
  buyers: EthBuyerConfig[]
): Promise<boolean> {
  const isClaimed = await Promise.all(
    buyers.map(async (config, tokenIndex): Promise<boolean> => {
      const wallet = config.wallet;

      const receipt = await claimContributorRefundOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        tokenIndex,
        wallet
      );

      return refundIsClaimedOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        tokenIndex,
        wallet
      );
    })
  );

  return isClaimed.reduce((prev, curr): boolean => {
    return prev && curr;
  });
}

export async function getRefundRecipientBalanceOnEth(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig
): Promise<ethers.BigNumber> {
  const tokenAddress = hexToNativeString(
    saleInit.tokenAddress,
    saleInit.tokenChain as ChainId
  );
  if (tokenAddress === undefined) {
    throw Error("tokenAddress is undefined");
  }

  const refundRecipient = hexToNativeString(
    saleInit.refundRecipient,
    saleInit.tokenChain as ChainId
  );
  if (refundRecipient === undefined) {
    throw Error("refundRecipient is undefined");
  }

  return getErc20Balance(
    conductorConfig.wallet.provider,
    tokenAddress,
    refundRecipient
  );
}

export async function redeemOneAllocation(
  srcChainId: ChainId,
  sequence: string,
  contributorConfigs: EthContributorConfig[]
): Promise<ethers.ContractReceipt> {
  const signedVaa = await getSignedVaaFromSequence(
    srcChainId,
    getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS),
    sequence
  );

  const chainId = await getTargetChainIdFromTransferVaa(signedVaa);
  const config = contributorConfigs.find((config) => {
    return config.chainId === chainId;
  });
  if (config === undefined) {
    throw Error("cannot find chainId in contributorConfigs");
  }

  return redeemOnEth(ETH_TOKEN_BRIDGE_ADDRESS, config.wallet, signedVaa);
}

export async function redeemCrossChainAllocations(
  saleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
): Promise<ethers.ContractReceipt[][]> {
  const signedVaas = await getSignedVaasFromSequences(
    saleResult.conductorChainId,
    getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS),
    saleResult.bridgeSequences
  );

  // redeem transfers before calling saleSealed
  const chainVaas = new Map<ChainId, Uint8Array[]>();
  for (const signedVaa of signedVaas) {
    const chainId = await getTargetChainIdFromTransferVaa(signedVaa);

    // verify this chainId exists in our contributor configs
    const config = contributorConfigs.find((config) => {
      return config.chainId === chainId;
    });
    if (config === undefined) {
      throw Error("cannot find chainId in contributorConfigs");
    }

    if (!chainVaas.has(chainId)) {
      chainVaas.set(chainId, []);
    }
    const vaas = chainVaas.get(chainId);
    vaas?.push(signedVaa);
  }

  return Promise.all(
    contributorConfigs.map(
      async (config): Promise<ethers.ContractReceipt[]> => {
        const signedVaas = chainVaas.get(config.chainId);
        if (signedVaas === undefined) {
          return [];
        }
        const receipts: ethers.ContractReceipt[] = [];
        for (const signedVaa of signedVaas) {
          const receipt = await redeemOnEth(
            ETH_TOKEN_BRIDGE_ADDRESS,
            config.wallet,
            signedVaa
          );
          receipts.push(receipt);
        }
        return receipts;
      }
    )
  );
}

describe("helpers should exist", () => {
  it("dummy test", () => {
    expect.assertions(0);
  });
});
