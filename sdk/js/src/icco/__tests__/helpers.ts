import { describe, expect, it } from "@jest/globals";
import { ethers } from "ethers";
import Web3 from "web3";
const elliptic = require('elliptic');
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  Contributor__factory,
  ERC20__factory,
  TokenImplementation,
  TokenImplementation__factory,
} from "../../ethers-contracts";
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
  uint8ArrayToNative,
} from "../..";
import {
  AcceptedToken,
  SaleInit,
  SaleSealed,
  abortSaleBeforeStartOnEth,
  attestContributionsOnEth,
  initSaleOnEth,
  claimAllocationOnEth,
  claimConductorRefundOnEth,
  claimContributorRefundOnEth,
  collectContributionsOnEth,
  createSaleOnEth,
  contributeOnEth,
  secureContributeOnEth,
  extractVaaPayload,
  getAllocationIsClaimedOnEth,
  getCurrentBlock,
  getErc20Balance,
  getRefundIsClaimedOnEth,
  getSaleContributionOnEth,
  getSaleFromConductorOnEth,
  getSaleFromContributorOnEth,
  makeAcceptedToken,
  makeAcceptedWrappedTokenEth,
  nativeToUint8Array,
  parseSaleInit,
  parseSaleSealed,
  sealSaleOnEth,
  saleSealedOnEth,
  sleepFor,
  wrapEth,
  saleAbortedOnEth,
  sealSaleAndParseReceiptOnEth,
  SealSaleResult,
  getSaleWalletAllocationOnEth,
} from "..";
import {
  ETH_CORE_BRIDGE_ADDRESS,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
  KYC_PRIVATE_KEYS,
  WORMHOLE_RPC_HOSTS,
} from "./consts";
import { CHAIN_ID_ETH } from "../../utils";

const ERC20 = require("@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json");

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
  tokenIndex: number;
}

enum BalanceChange {
  Increase = 1,
  Decrease,
}

export async function deployTokenOnEth(
  rpc: string,
  name: string,
  symbol: string,
  amount: string,
  wallet: ethers.Wallet
): Promise<string> {
  const web3 = new Web3(rpc);
  const accounts = await web3.eth.getAccounts();
  const erc20Contract = new web3.eth.Contract(ERC20.abi);
  let erc20 = await erc20Contract
    .deploy({
      data: ERC20.bytecode,
      arguments: [name, symbol],
    })
    .send({
      from: accounts[2],
      gas: 5000000,
    });

  await erc20.methods.mint(accounts[2], amount).send({
    from: accounts[2],
    gas: 1000000,
  });

  return erc20.options.address;
}

// TODO: add terra and solana handling to this (doing it serially here to make it easier to adapt)
export async function makeAcceptedTokensFromConfigs(
  configs: EthContributorConfig[],
  potentialBuyers: EthBuyerConfig[]
): Promise<AcceptedToken[]> {
  const acceptedTokens: AcceptedToken[] = [];

  // create map to record which accepted tokens have been created 
  const tokenMap: Map<number, string[]> = new Map<number, string[]>();

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

    if (!tokenMap.has(buyer.chainId)) {
        const addressArray: string[] = [buyer.collateralAddress];
        tokenMap.set(buyer.chainId, addressArray);
    } else {
        const addressArray = tokenMap.get(buyer.chainId) || [];
        if (!addressArray.includes(buyer.collateralAddress)) {
            addressArray.push(buyer.collateralAddress);
            tokenMap.set(buyer.chainId, addressArray);
        } else {
            continue;
        }
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
  buyers: EthBuyerConfig[],
  wrapIndices: number[],
  transferFromIndices: number[] | undefined,
  transferToIndices: number[] | undefined
): Promise<void> {
  await Promise.all(
    wrapIndices.map(async (index): Promise<void> => {
      return wrapEth(
        buyers[index].collateralAddress,
        buyers[index].contribution,
        buyers[index].wallet
      );
    })
  );

  // transfer eth/bnb to other wallets
  if (transferFromIndices !== undefined) {
    if (transferToIndices === undefined) {
      throw Error("transferTo is undefined");
    }
    if (transferToIndices.length !== transferFromIndices.length) {
      throw Error("transferTo.length !== transferFrom.length");
    }

    const receipts = await Promise.all(
      transferFromIndices.map(async (fromIndex, i) => {
        const sender = buyers[fromIndex];

        const toIndex = transferToIndices[i];
        const receiver = buyers[toIndex];

        return transferFromEthNativeAndRedeemOnEth(
          sender.wallet,
          sender.chainId,
          receiver.contribution,
          receiver.wallet,
          receiver.chainId
        );
      })
    );
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
  maxRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  acceptedTokens: AcceptedToken[]
): Promise<Uint8Array> {
  // create
  const receipt = await createSaleOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    tokenAddress,
    amount,
    minRaise,
    maxRaise,
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
  buyers: EthBuyerConfig[],
  rpc: string
): Promise<boolean> {
  const saleId = saleInit.saleId;

  const contributions = await Promise.all(
    buyers.map(async (config): Promise<ethers.BigNumber> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      const decimals = await token.decimals();
      return ethers.utils.parseUnits(config.contribution, decimals);
    })
  );

  // contribute
  {
    const receipts = await Promise.all(
      buyers.map(
        async (config, i): Promise<ethers.ContractReceipt> => {
          // perform KYC 
          const signature = await signContribution(
            rpc,
            nativeToHexString(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS, saleInit.tokenChain as ChainId)!,
            saleId,
            config.tokenIndex,
            contributions[i],
            buyers[i].wallet.address,
            KYC_PRIVATE_KEYS
          );

          return contributeOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            saleId,
            config.tokenIndex,
            contributions[i],
            config.wallet,
            signature
          );
        }
      )
    );
  }

  // check contributions
  const expected = await getAllContributions(saleInit, buyers);

  return buyers
    .map((config, i): boolean => {
      return contributions[i].eq(expected[i]);
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function secureContributeAllTokensOnEth(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  saleTokenAddress: string,
  rpc: string
): Promise<boolean> {
  const saleId = saleInit.saleId;

  const contributions = await Promise.all(
    buyers.map(async (config): Promise<ethers.BigNumber> => {
      const token = ERC20__factory.connect(
        config.collateralAddress,
        config.wallet
      );
      const decimals = await token.decimals();
      return ethers.utils.parseUnits(config.contribution, decimals);
    })
  );

  // contribute
  {
    const receipts = await Promise.all(
      buyers.map(
        async (config, i): Promise<ethers.ContractReceipt> => {
          const signature = await signContribution(
            rpc,
            nativeToHexString(ETH_TOKEN_SALE_CONDUCTOR_ADDRESS, saleInit.tokenChain as ChainId)!,
            saleId,
            config.tokenIndex,
            contributions[i],
            buyers[i].wallet.address,
            KYC_PRIVATE_KEYS
          );      

          return secureContributeOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            saleId,
            config.tokenIndex,
            contributions[i],
            saleTokenAddress,
            config.wallet,
            signature
          );
        }
      )
    );
  }
  // check contributions
  const expected = await getAllContributions(saleInit, buyers);

  return buyers
    .map((config, i): boolean => {
      return contributions[i].eq(expected[i]);
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
  maxRaise: string,
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
    ethers.utils.parseUnits(maxRaise),
    saleStart,
    saleEnd,
    acceptedTokens
  );

  console.info("Sale Init VAA:", Buffer.from(saleInitVaa).toString("hex"));

  const saleInit = await parseSaleInit(saleInitVaa);

  {
    const receipts = await Promise.all(
      contributorConfigs.map(
        async (config): Promise<ethers.ContractReceipt> => {
          return initSaleOnEth(
            ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
            saleInitVaa,
            config.wallet
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


interface SealSaleResult {
  sealed: boolean;
  aborted: boolean;
  conductorChainId: ChainId;
  bridgeSequences: string[];
  conductorSequence: string;
}
*/

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
      signedVaas,
      conductorConfig.wallet
    );
  }
  return;
}

async function _sealOrAbortSaleOnEth(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[]
): Promise<void> {
  const saleId = saleInit.saleId;

  // attest contributions and use vaas to seal sale
  {
    await attestAndCollectContributions(
      saleInit,
      conductorConfig,
      contributorConfigs
    );
  }

  const sealReceipt = await sealSaleOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    saleId,
    conductorConfig.wallet
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
  return;
}

export async function sealOrAbortSaleOnEth(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig,
  contributorConfigs: EthContributorConfig[]
): Promise<SealSaleResult> {
  const saleId = saleInit.saleId;

  // attest contributions and use vaas to seal sale
  {
    await attestAndCollectContributions(
      saleInit,
      conductorConfig,
      contributorConfigs
    );
  }

  return sealSaleAndParseReceiptOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    saleId,
    ETH_CORE_BRIDGE_ADDRESS,
    ETH_TOKEN_BRIDGE_ADDRESS,
    WORMHOLE_RPC_HOSTS,
    {
      transport: NodeHttpTransport(),
    },
    conductorConfig.wallet
  );
}

export async function getWrappedSaleTokenAddresses(
  saleInit: SaleInit,
  contributorConfigs: EthConductorConfig[]
): Promise<string[]> {
  const originChain = saleInit.tokenChain as ChainId;
  const originAsset = hexToUint8Array(saleInit.tokenAddress);

  return Promise.all(
    contributorConfigs.map(async (config): Promise<string> => {
      if (config.chainId === originChain) {
        return uint8ArrayToNative(originAsset, originChain) || "";
      }
      const foreignAsset = await getForeignAssetEth(
        ETH_TOKEN_BRIDGE_ADDRESS,
        config.wallet,
        originChain,
        originAsset
      );
      if (
        foreignAsset === null ||
        foreignAsset === ethers.constants.AddressZero
      ) {
        throw Error("sale token not attested");
      }
      return foreignAsset;
    })
  );
}

export async function sealSaleAtContributors(
  saleInit: SaleInit,
  saleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
) {
  if (!saleResult.sale.isSealed) {
    throw Error("sale was not sealed");
  }

  const signedVaa = saleResult.sealSaleVaa;

  const saleSealed = await parseSaleSealed(signedVaa);

  // first check if the sale token has been attested
  {
    const addresses = await getWrappedSaleTokenAddresses(
      saleInit,
      contributorConfigs
    );
  }

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
  saleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
) {
  const signedVaa = saleResult.sealSaleVaa;

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

export async function getAllContributions(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[]
): Promise<ethers.BigNumberish[]> {
  const saleId = saleInit.saleId;
  const contributions = await Promise.all(
    buyers.map(async (config, i): Promise<ethers.BigNumber> => {
      const wallet = config.wallet;

      return getSaleContributionOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        wallet.provider,
        saleId,
        config.tokenIndex,
        wallet.address
      );
    })
  );
  return contributions.map((contribution): string => {
    return contribution.toString();
  });
}

export async function getAllAllocations(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[]
): Promise<ethers.BigNumberish[]> {
  const saleId = saleInit.saleId;
  const allocations = await Promise.all(
    buyers.map(async (config, i): Promise<ethers.BigNumber> => {
      const wallet = config.wallet;

      return getSaleWalletAllocationOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        wallet.provider,
        saleId,
        config.tokenIndex,
        wallet.address
      );
    })
  );
  return allocations.map((allocation): string => {
    return allocation.toString();
  });
}

export async function contributionsReconcile(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): Promise<boolean> {
  const expected = await getAllContributions(saleInit, buyers);

  return buyers
    .map((config, index): boolean => {
      return balanceChangeReconciles(
        before[index],
        after[index],
        BalanceChange.Decrease,
        expected[index]
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function allocationsReconcile(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): Promise<boolean> {
  const expected = await getAllAllocations(saleInit, buyers);

  return buyers
    .map((config, index): boolean => {
      return balanceChangeReconciles(
        before[index],
        after[index],
        BalanceChange.Increase,
        expected[index]
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function refundsReconcile(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  before: ethers.BigNumberish[],
  after: ethers.BigNumberish[]
): Promise<boolean> {
  const expected = await getAllContributions(saleInit, buyers);

  return buyers
    .map((config, index): boolean => {
      return balanceChangeReconciles(
        before[index],
        after[index],
        BalanceChange.Increase,
        expected[index]
      );
    })
    .reduce((prev, curr): boolean => {
      return prev && curr;
    });
}

export async function claimAllAllocationsOnEth(
  saleSealed: SaleSealed,
  buyers: EthBuyerConfig[]
): Promise<boolean> {
  const saleId = saleSealed.saleId;

  const isClaimed = await Promise.all(
    buyers.map(async (config, i): Promise<boolean> => {
      const wallet = config.wallet;

      const receipt = await claimAllocationOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        saleId,
        config.tokenIndex,
        wallet
      );

      return getAllocationIsClaimedOnEth(
        ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
        wallet.provider,
        saleId,
        config.tokenIndex,
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

export async function claimOneContributorRefundOnEth(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  buyerIndex: number
) {
  const saleId = saleInit.saleId;
  const wallet = buyers[buyerIndex].wallet;

  const receipt = await claimContributorRefundOnEth(
    ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
    saleInit.saleId,
    buyers[buyerIndex].tokenIndex,
    wallet
  );

  return getRefundIsClaimedOnEth(
    ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
    wallet.provider,
    saleId,
    buyers[buyerIndex].tokenIndex,
    wallet.address
  );
}

export async function claimAllBuyerRefundsOnEth(
  saleInit: SaleInit,
  buyers: EthBuyerConfig[],
  claimed: boolean[] | undefined
): Promise<boolean> {
  const saleId = saleInit.saleId;

  const isClaimed = await Promise.all(
    buyers.map(async (config, i): Promise<boolean> => {
      if (claimed !== undefined && claimed[i]) {
        return true;
      }

      return claimOneContributorRefundOnEth(saleInit, buyers, i);
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

export async function redeemCrossChainAllocations(
  saleResult: SealSaleResult,
  contributorConfigs: EthContributorConfig[]
): Promise<ethers.ContractReceipt[][]> {
  // redeem transfers before calling saleSealed
  const transferVaas = saleResult.transferVaas;

  return Promise.all(
    contributorConfigs.map(
      async (config): Promise<ethers.ContractReceipt[]> => {
        const signedVaas = transferVaas.get(config.chainId);
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

export async function abortSaleEarlyAtConductor(
  saleInit: SaleInit,
  conductorConfig: EthContributorConfig
): Promise<ethers.ContractReceipt> {
  const receipt = await abortSaleBeforeStartOnEth(
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    saleInit.saleId,
    conductorConfig.wallet
  );
  return receipt;
}

export async function abortSaleEarlyAtContributors(
  abortEarlyReceipt: ethers.ContractReceipt,
  contributorConfigs: EthContributorConfig[],
  conductorConfig: EthContributorConfig
) {
  const signedVaa = await getSignedVaaFromReceiptOnEth(
    conductorConfig.chainId,
    ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
    abortEarlyReceipt
  );

  {
    const receipts = await Promise.all(
      contributorConfigs.map(async (config) => {
        const contributor = Contributor__factory.connect(
          ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
          config.wallet
        );

        const tx = await contributor.saleAborted(signedVaa);
        return tx.wait();
      })
    );
  }

  return;
}

export async function signContribution(
    rpc: string,
    conductorAddress: string,
    saleId: ethers.BigNumberish,
    tokenIndex: number,
    amount: ethers.BigNumberish,
    buyerAddress: string,
    signer: string
): Promise<ethers.BytesLike> {
    const web3 = new Web3(rpc);

    const body = [
        web3.eth.abi.encodeParameter("bytes32", "0x"+conductorAddress).substring(2),
        web3.eth.abi.encodeParameter("uint256", saleId).substring(2),
        web3.eth.abi.encodeParameter("uint256", tokenIndex).substring(2),
        web3.eth.abi.encodeParameter("uint256", amount).substring(2),
        web3.eth.abi.encodeParameter("address", buyerAddress).substring(2 + (64 - 40))
    ];

    // compute the hash
    const msg = Buffer.from("0x" + body.join(""));
    const hash = web3.utils.soliditySha3(msg.toString());

    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPrivate(signer.substring(2));
    const signature = key.sign(hash?.substr(2), {canonical: true});

    const packSig = [
        zeroPadBytes(signature.r.toString(16), 32),
        zeroPadBytes(signature.s.toString(16), 32),
        web3.eth.abi.encodeParameter("uint8", signature.recoveryParam).substr(2 + (64 - 2)),
    ];

    return "0x" + packSig.join("");
}

function zeroPadBytes(value: string, length: number) {
    while (value.length < 2 * length) {
        value = "0" + value;
    }
    return value;
}

describe("helpers should exist", () => {
  it("dummy test", () => {
    expect.assertions(0);
  });
});
