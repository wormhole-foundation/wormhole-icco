import { describe, expect, it } from "@jest/globals";
import { formatUnits, parseUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import {
  CHAIN_ID_ETH,
  ChainId,
  Conductor__factory,
  Contributor__factory,
  ERC20,
  ERC20__factory,
  hexToUint8Array,
  nativeToHexString,
  getSignedVAAWithRetry,
  getEmitterAddressEth,
  getForeignAssetEth,
  parseSequenceFromLogEth,
  parseSequencesFromLogEth,
  redeemOnEth,
  transferFromEthNative,
  attestFromEth,
  createWrappedOnEth,
  getOriginalAssetEth,
  uint8ArrayToNative,
  uint8ArrayToHex,
  hexToNativeString,
  Contributor,
} from "../..";
import {
  ETH_CORE_BRIDGE_ADDRESS,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
  WORMHOLE_RPC_HOSTS,
} from "./consts";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  AcceptedToken,
  createSaleOnEth,
  IccoSaleInit,
  initSaleOnEth,
  makeAcceptedToken,
  makeAcceptedWrappedTokenEth,
  parseIccoSaleInit,
} from "../createSale";
import { contributeOnEth, getSaleContribution } from "../contribute";
import {
  extractVaaPayload,
  getCurrentBlock,
  getErc20Balance,
  nativeToUint8Array,
  sleepFor,
} from "../misc";
import {
  IccoSaleSealed,
  parseIccoSaleSealed,
  sealSaleOnEth,
} from "../sealSale";
import {
  allocationIsClaimedOnEth,
  claimAllocationOnEth,
} from "../claimAllocation";
import { attestContributionsOnEth } from "../attestContributions";
import {
  claimConductorRefundOnEth,
  claimContributorRefundOnEth,
  refundIsClaimedOnEth,
} from "../claimRefund";

export interface BuyerConfig {
  chainId: ChainId;
  wallet: ethers.Wallet;
  collateralAddress: string;
  contribution: string;
}

export interface ContributorConfig {
  chainId: ChainId;
  wallet: ethers.Wallet;
  collateralAddress: string;
  conversionRate: string;
}

// TODO: add terra and solana handling to this (doing it serially here to make it easier to adapt)
export async function makeAcceptedTokensFromConfigs(
  configs: ContributorConfig[],
  potentialBuyers: BuyerConfig[]
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
  srcSeller: ContributorConfig,
  dstSeller: ContributorConfig
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
    parseUnits(amount),
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
  token: ERC20,
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
    seller,
    token,
    amount,
    minRaise,
    saleStart,
    saleEnd,
    acceptedTokens
  );

  return getSignedVaaFromReceiptOnEth(
    chainId,
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    receipt
  );
}

export async function getCollateralBalancesOnEth(
  buyers: BuyerConfig[]
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
  saleInit: IccoSaleInit,
  buyers: BuyerConfig[]
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
            parseUnits(config.contribution, decimals[tokenIndex]),
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
      return parseUnits(config.contribution, decimals[tokenIndex]).eq(
        contributions[tokenIndex]
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function getLatestBlockTime(
  ContributorConfigs: ContributorConfig[]
): Promise<number> {
  const currentBlocks = await Promise.all(
    ContributorConfigs.map((config): Promise<ethers.providers.Block> => {
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

export async function createSaleOnEthAndInit(
  conductorConfig: ContributorConfig,
  contributorConfigs: ContributorConfig[],
  saleTokenAddress: string,
  tokenAmount: string,
  minRaise: string,
  saleStart: number,
  saleDuration: number,
  acceptedTokens: AcceptedToken[]
): Promise<IccoSaleInit> {
  const tokenOffered = ERC20__factory.connect(
    saleTokenAddress,
    conductorConfig.wallet
  );
  const decimals = await tokenOffered.decimals();

  const saleEnd = saleStart + saleDuration;

  const initSaleVaa = await createSaleOnEthAndGetVaa(
    conductorConfig.wallet,
    conductorConfig.chainId,
    tokenOffered,
    parseUnits(tokenAmount, decimals),
    parseUnits(minRaise),
    saleStart,
    saleEnd,
    acceptedTokens
  );

  // parse vaa for ICCOStruct
  const initSale = await parseIccoSaleInit(initSaleVaa);

  {
    const receipts = await Promise.all(
      contributorConfigs.map(
        async (config): Promise<ethers.ContractReceipt> => {
          return initSaleOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            config.wallet,
            initSaleVaa
          );
        }
      )
    );
  }

  return initSale;
}

export async function waitForSaleToStart(
  contributorConfigs: ContributorConfig[],
  saleInit: IccoSaleInit,
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
  contributorConfigs: ContributorConfig[],
  saleInit: IccoSaleInit,
  extraTime: number // seconds
): Promise<void> {
  const timeNow = await getLatestBlockTime(contributorConfigs);
  const timeLeftForSale = Number(saleInit.saleEnd) - timeNow;
  if (timeLeftForSale > 0) {
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

interface IccoSaleResult {
  saleSealed: IccoSaleSealed | undefined;
  sealed: boolean;
  aborted: boolean;
}

export async function sealOrAbortSaleOnEth(
  conductorConfig: ContributorConfig,
  contributorConfigs: ContributorConfig[],
  saleInit: IccoSaleInit
): Promise<IccoSaleResult> {
  const saleId = saleInit.saleId;

  const conductor = Conductor__factory.connect(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    conductorConfig.wallet
  );

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
    for (const signedVaa of signedVaas) {
      const collectTx = await conductor.collectContribution(signedVaa);
      await collectTx.wait();
    }
  }

  const sealReceipt = await sealSaleOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    conductorConfig.wallet,
    saleId
  );

  // we have token transfers and saleSealed vaas. first grab
  // the last vaa sent, which is the saleSealed message
  const sequences = parseSequencesFromEthReceipt(sealReceipt);
  const completeSaleSequence = sequences.pop();
  if (completeSaleSequence === undefined) {
    throw Error("no sequences found in sealSale receipt");
  }

  const saleCompletionVaa = await getSignedVaaFromSequence(
    conductorConfig.chainId,
    getEmitterAddressEth(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS),
    completeSaleSequence
  );

  // redeem token transfer vaas
  {
    const signedVaas = await getSignedVaasFromSequences(
      conductorConfig.chainId,
      getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS),
      sequences
    );

    const receipts = await redeemMultiChainTransfersFromConfigs(
      contributorConfigs,
      signedVaas
    );
  }

  const sale = await conductor.sales(saleId);
  // if the sale is sealed, get ready for distribution
  if (sale.isSealed) {
    const saleSealed = await parseIccoSaleSealed(saleCompletionVaa);

    // set sale sealed for each contributor
    const receipts = await Promise.all(
      contributorConfigs.map(async (config) => {
        const contributor = Contributor__factory.connect(
          ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
          config.wallet
        );
        const tx = await contributor.saleSealed(saleCompletionVaa);
        return tx.wait();
      })
    );

    return {
      saleSealed: saleSealed,
      sealed: true,
      aborted: false,
    };
  }

  if (!sale.isAborted) {
    throw Error("neither isSealed nor isAborted are set");
  }

  // but if the sale is aborted... abort!
  {
    const receipts = await Promise.all(
      contributorConfigs.map(async (config) => {
        const contributor = Contributor__factory.connect(
          ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
          config.wallet
        );

        const tx = await contributor.saleAborted(saleCompletionVaa);
        return tx.wait();
      })
    );
  }

  // claim refund for refundRecipient
  const reeipt = await claimConductorRefundOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    saleId,
    conductorConfig.wallet
  );

  return {
    saleSealed: undefined,
    sealed: false,
    aborted: true,
  };
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
  buyers: BuyerConfig[],
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
        parseUnits(config.contribution, decimals[index]).toString()
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function refundsReconcile(
  buyers: BuyerConfig[],
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
        parseUnits(config.contribution, decimals[index]).toString()
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function claimAllAllocationsOnEth(
  buyers: BuyerConfig[],
  saleSealed: IccoSaleSealed
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

      return allocationIsClaimedOnEth(
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

export async function getAllocationBalancesOnEth(
  saleInit: IccoSaleInit,
  buyers: BuyerConfig[]
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
  saleSealed: IccoSaleSealed,
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
  buyers: BuyerConfig[]
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

// private
enum BalanceChange {
  Increase = 1,
  Decrease,
}

async function redeemMultiChainTransfersFromConfigs(
  contributorConfigs: ContributorConfig[],
  signedVaas: Uint8Array[]
): Promise<ethers.ContractReceipt[][]> {
  // redeem transfers before calling saleSealed
  const chainVaas = new Map<ChainId, Uint8Array[]>();
  for (const signedVaa of signedVaas) {
    const payload = await extractVaaPayload(signedVaa);
    const chainId = Buffer.from(payload).readUInt16BE(99) as ChainId;

    // verify this chainId exists in our contributor configs
    const findIndex = contributorConfigs.findIndex((config) => {
      return config.chainId === chainId;
    });
    if (findIndex < 0) {
      throw Error("cannot find chainId in contributorConfigs");
    }

    if (!chainVaas.has(chainId)) {
      chainVaas.set(chainId, []);
    }
    const vaas = chainVaas.get(chainId);
    vaas?.push(signedVaa);
  }

  return await Promise.all(
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
