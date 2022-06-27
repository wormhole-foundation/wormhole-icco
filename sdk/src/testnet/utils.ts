import { ethers } from "ethers";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  ChainId,
  ERC20__factory,
  parseSequencesFromLogEth,
  getSignedVAAWithRetry,
  getEmitterAddressEth,
  tryNativeToHexString,
  importCoreWasm,
  redeemOnEth,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  getForeignAssetEth,
  tryNativeToUint8Array,
  transferFromSolana,
  getEmitterAddressSolana,
  attestFromSolana,
  CHAIN_ID_AVAX,
  redeemOnSolana,
  postVaaSolanaWithRetry,
  tryUint8ArrayToNative,
  getOriginalAssetEth,
} from "@certusone/wormhole-sdk";
import {
  makeAcceptedToken,
  initSaleOnEth,
  createSaleOnEth,
  getCurrentBlock,
  sleepFor,
  secureContributeOnEth,
  parseSaleInit,
  attestContributionsOnEth,
  collectContributionsOnEth,
  sealSaleOnEth,
  getSaleFromConductorOnEth,
  getTargetChainIdFromTransferVaa,
  parseSaleSealed,
  saleSealedOnEth,
  normalizeConversionRate,
  getErc20Decimals,
  claimAllocationOnEth,
  getAllocationIsClaimedOnEth,
  getSaleContributionOnEth,
  nativeToUint8Array,
  abortSaleBeforeStartOnEth,
  saleAbortedOnEth,
  getSaleIdFromIccoVaa,
  claimContributorRefundOnEth,
} from "../";
import {
  WORMHOLE_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_NETWORKS,
  TESTNET_ADDRESSES,
  CONDUCTOR_ADDRESS,
  SALE_CONFIG,
  KYC_AUTHORITY_KEY,
  CHAIN_ID_TO_NETWORK,
  CONDUCTOR_CHAIN_ID,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SOLANA_TOKEN_BRIDGE_ADDRESS,
  WORMHOLE_RPCS,
  SOLANA_RPC,
  AVAX_TOKEN_BRIDGE_ADDRESS,
} from "./consts";
import { TokenConfig, Contribution, SealSaleResult, SaleParams, SaleSealed, AcceptedToken, SaleInit } from "./structs";
import { signContributionOnEth } from "./kyc";
import {
  claimExcessContributionOnEth,
  getErc20Balance,
  getExcessContributionIsClaimedOnEth,
  getSaleExcessContributionOnEth,
} from "../icco";
import { web3 } from "@project-serum/anchor";
import { getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { SignedVAAWithQuorum } from "@certusone/wormhole-sdk/lib/cjs/proto/gossip/v1/gossip";
import { getBlockTime, wait } from "../anchor/utils";

export async function extractVaaPayload(signedVaa: Uint8Array): Promise<Uint8Array> {
  const { parse_vaa } = await importCoreWasm();
  const { payload: payload } = parse_vaa(signedVaa);
  return payload;
}

export async function parseVaaPayload(signedVaa: Uint8Array) {
  const { parse_vaa } = await importCoreWasm();
  let parsedVaa = parse_vaa(signedVaa);
  return parsedVaa;
}

export function getCurrentTime(): number {
  return Math.floor(Date.now() / 1000);
}

export function testRpc(network: string): string {
  return SALE_CONFIG["initiatorWallet"][network].rpc;
}

export function testProvider(network: string): ethers.providers.Provider {
  // borrow the initiators rpc
  return new ethers.providers.JsonRpcProvider(testRpc(network));
}

export function initiatorWallet(network: string): ethers.Wallet {
  // several wallets owned by the "sale" initiator
  const provider = testProvider(network);
  const wallet: ethers.Wallet = new ethers.Wallet(SALE_CONFIG["initiatorWallet"][network].key, provider);
  return wallet;
}

export function contributorWallet(contribution: Contribution): ethers.Wallet {
  const provider = testProvider(CHAIN_ID_TO_NETWORK.get(contribution.chainId));
  const wallet: ethers.Wallet = new ethers.Wallet(contribution.key, provider);
  return wallet;
}

export async function getTokenDecimals(chainId: ChainId, tokenAddress: string): Promise<number> {
  if (chainId == CHAIN_ID_SOLANA) {
    const mintContract = await getMint(new web3.Connection(SOLANA_RPC), new web3.PublicKey(tokenAddress));
    return mintContract.decimals;
  }
  const network = CHAIN_ID_TO_NETWORK.get(chainId);
  return getErc20Decimals(testProvider(network), tokenAddress);
}

export async function buildAcceptedTokens(tokenConfig: TokenConfig[]): Promise<AcceptedToken[]> {
  const acceptedTokens: AcceptedToken[] = [];

  for (const config of tokenConfig) {
    const network = CHAIN_ID_TO_NETWORK.get(config.chainId);
    const wallet = initiatorWallet(network);
    const token = ERC20__factory.connect(config.address, wallet);
    const tokenDecimals = await token.decimals();

    // normalize the conversion rate and then push the accepted token
    const normalizedConversionRate = await normalizeConversionRate(
      SALE_CONFIG.denominationDecimals,
      tokenDecimals,
      config.conversionRate
    );
    acceptedTokens.push(makeAcceptedToken(config.chainId, config.address, normalizedConversionRate));
  }
  return acceptedTokens;
}

export function parseSequencesFromEthReceipt(receipt: ethers.ContractReceipt, network: string): string[] {
  return parseSequencesFromLogEth(receipt, WORMHOLE_ADDRESSES[network].wormhole);
}

export async function getSignedVaaFromSequence(
  chainId: ChainId,
  emitterAddress: string,
  sequence: string
): Promise<Uint8Array> {
  console.log("Looking for VAA with sequence:", sequence);
  const result = await getSignedVAAWithRetry(WORMHOLE_ADDRESSES.guardianRpc, chainId, emitterAddress, sequence, {
    transport: NodeHttpTransport(),
  });
  console.log("Found signed VAA for sequence:", sequence);
  return result.vaaBytes;
}

export async function getSignedVaaFromReceiptOnEth(
  chainId: ChainId,
  contractAddress: string,
  receipt: ethers.ContractReceipt,
  network: string
): Promise<Uint8Array> {
  const sequences = parseSequencesFromEthReceipt(receipt, network);

  if (sequences.length !== 1) {
    throw Error("more than one sequence found in log");
  }

  return getSignedVaaFromSequence(chainId, getEmitterAddressEth(contractAddress), sequences[0]);
}

export async function createSaleOnEthAndGetVaa(
  seller: ethers.Wallet,
  conductorAddress: string,
  isFixedPrice: boolean,
  localTokenAddress: string,
  saleTokenAddress: string,
  saleTokenChain: ChainId,
  amount: ethers.BigNumberish,
  minRaise: ethers.BigNumberish,
  maxRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  unlockTimestamp: ethers.BigNumberish,
  recipientAddress: string,
  refundRecipientAddress: string,
  authority: string,
  acceptedTokens: AcceptedToken[],
  solanaTokenAccount: ethers.BytesLike
): Promise<Uint8Array[]> {
  // create the sale on the conductor
  const receipt = await createSaleOnEth(
    conductorAddress,
    isFixedPrice,
    localTokenAddress,
    saleTokenAddress,
    saleTokenChain,
    amount,
    minRaise,
    maxRaise,
    saleStart,
    saleEnd,
    unlockTimestamp,
    acceptedTokens,
    solanaTokenAccount,
    recipientAddress,
    refundRecipientAddress,
    authority,
    seller
  );

  // fetch sequences from receipt
  const sequences = parseSequencesFromLogEth(receipt, WORMHOLE_ADDRESSES[CONDUCTOR_NETWORK].wormhole);

  const saleInitSequence = sequences[sequences.length - 1];
  if (saleInitSequence === undefined) {
    console.log("no vaa sequences found");
  }

  // fetch VAA for each sequence in the receipt
  const signedVaas: Uint8Array[] = [];
  for (const sequence of sequences) {
    const signedVaa = await getSignedVaaFromSequence(
      CONDUCTOR_CHAIN_ID,
      getEmitterAddressEth(CONDUCTOR_ADDRESS),
      sequence
    );
    signedVaas.push(signedVaa);
  }
  return signedVaas;
}

export async function createSaleOnEthConductor(
  initiatorConductorWallet: ethers.Wallet,
  conductorAddress: string,
  raiseParams: SaleParams,
  acceptedTokens: AcceptedToken[]
): Promise<Uint8Array[]> {
  // fetch localToken decimals
  const decimals = await getErc20Decimals(testProvider(CONDUCTOR_NETWORK), raiseParams.localTokenAddress);

  // set up sale token contract to interact with
  const saleStart = getCurrentTime() + raiseParams.saleStartTimer;
  const saleEnd = saleStart + raiseParams.saleDurationSeconds;
  const unlockTimestamp = saleEnd + raiseParams.lockUpDurationSeconds;

  // create fake solana ATA
  const solanaTokenAccount = nativeToUint8Array(
    raiseParams.localTokenAddress,
    CHAIN_ID_ETH // will be CHAIN_ID_SOLANA with a real token
  );

  // create the sale
  const saleInitVaas = await createSaleOnEthAndGetVaa(
    initiatorConductorWallet,
    conductorAddress,
    raiseParams.isFixedPrice,
    raiseParams.localTokenAddress,
    raiseParams.token,
    raiseParams.tokenChain,
    ethers.utils.parseUnits(raiseParams.tokenAmount, decimals),
    ethers.utils.parseUnits(raiseParams.minRaise, SALE_CONFIG.denominationDecimals),
    ethers.utils.parseUnits(raiseParams.maxRaise, SALE_CONFIG.denominationDecimals),
    saleStart,
    saleEnd,
    unlockTimestamp,
    raiseParams.recipient,
    raiseParams.refundRecipient,
    raiseParams.authority,
    acceptedTokens,
    solanaTokenAccount
  );
  return saleInitVaas;
}

export async function initializeSaleOnEthContributors(saleInitVaa: Uint8Array): Promise<SaleInit> {
  // parse the sale init payload for return value
  const saleInitPayload = await extractVaaPayload(saleInitVaa);
  const saleInit = await parseSaleInit(saleInitPayload);

  {
    const receipts = await Promise.all(
      CONTRIBUTOR_NETWORKS.map(async (network): Promise<ethers.ContractReceipt> => {
        return initSaleOnEth(TESTNET_ADDRESSES[network], saleInitVaa, initiatorWallet(network));
      })
    );
  }

  return saleInit;
}

export async function getLatestBlockTime(isMax = true): Promise<number> {
  const currentBlocks = await Promise.all(
    CONTRIBUTOR_NETWORKS.map((network): Promise<ethers.providers.Block> => {
      return getCurrentBlock(testProvider(network));
    })
  );

  return currentBlocks
    .map((block): number => {
      return block.timestamp;
    })
    .reduce((prev, curr): number => {
      if (isMax) {
        return Math.max(prev, curr);
      } else {
        return Math.min(prev, curr);
      }
    });
}

export async function waitForSaleToStart(
  saleInit: SaleInit,
  extraTime: number // seconds
): Promise<void> {
  const timeNow = await getLatestBlockTime();
  const timeLeftForSale = Number(saleInit.saleStart) - timeNow;
  if (timeLeftForSale > 0) {
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

export async function waitForSaleToEnd(
  saleInit: SaleInit,
  extraTime: number // seconds
): Promise<void> {
  const timeNow = await getLatestBlockTime(false);
  const timeLeftForSale = Number(saleInit.saleEnd) - timeNow;
  if (timeLeftForSale > 0) {
    console.log("Sleeping for", timeLeftForSale + extraTime, "seconds");
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

export async function getTokenIndexFromConfig(chainId: ChainId, address: string): Promise<[boolean, number]> {
  const acceptedTokens: TokenConfig[] = SALE_CONFIG["acceptedTokens"];
  for (let i = 0; i < acceptedTokens.length; i++) {
    if (chainId === acceptedTokens[i].chainId && address === acceptedTokens[i].address) {
      return [true, i];
    }
  }
  // return 0 if token isn't found
  return [false, 0];
}

export async function parseUnits(contribution: Contribution, wallet: ethers.Wallet): Promise<ethers.BigNumberish> {
  // convert the contribution amount from string to big number
  const token = ERC20__factory.connect(contribution.address, wallet);
  const decimals = await token.decimals();
  const amount = ethers.utils.parseUnits(contribution.amount, decimals);
  return amount;
}

export async function prepareAndExecuteContribution(
  saleId: ethers.BigNumberish,
  saleTokenAddress: string,
  contribution: Contribution
): Promise<boolean> {
  // make sure contribution is for an accepted token
  let tokenIndex = 0;

  const indexInfo = await getTokenIndexFromConfig(contribution.chainId, contribution.address);

  if (indexInfo[0]) {
    tokenIndex = indexInfo[1];
  } else {
    return false;
  }

  // network for the contribution
  const network = CHAIN_ID_TO_NETWORK.get(contribution.chainId);

  // create wallet for the contributor
  const wallet: ethers.Wallet = contributorWallet(contribution);

  // format amount
  const amount: ethers.BigNumberish = await parseUnits(contribution, wallet);

  // get total contributed amount for kyc authority
  const totalContribution = await getSaleContributionOnEth(
    TESTNET_ADDRESSES[network],
    wallet.provider,
    saleId,
    tokenIndex,
    wallet.address
  );

  // get KYC signature
  const signature = await signContributionOnEth(
    tryNativeToHexString(CONDUCTOR_ADDRESS, contribution.chainId)!,
    saleId,
    tokenIndex,
    amount,
    wallet.address,
    totalContribution,
    KYC_AUTHORITY_KEY
  );

  // make the contribution
  try {
    const receipt = await secureContributeOnEth(
      TESTNET_ADDRESSES[network],
      saleId,
      tokenIndex,
      amount,
      saleTokenAddress,
      wallet,
      signature
    );
  } catch (error: any) {
    console.log(error);
    return false;
  }
  return true;
}

export async function attestContributionsOnContributor(saleInit: SaleInit): Promise<Uint8Array[]> {
  const saleId = saleInit.saleId;

  const signedVaas = await Promise.all(
    CONTRIBUTOR_NETWORKS.map(async (network): Promise<Uint8Array> => {
      const receipt = await attestContributionsOnEth(TESTNET_ADDRESSES[network], saleId, initiatorWallet(network));

      return getSignedVaaFromReceiptOnEth(
        WORMHOLE_ADDRESSES[network].chainId,
        TESTNET_ADDRESSES[network],
        receipt,
        network
      );
    })
  );

  return signedVaas;
}

export async function collectContributionsOnConductor(
  signedVaas: Uint8Array[],
  saleId: ethers.BigNumberish
): Promise<boolean[]> {
  const receipts = await collectContributionsOnEth(CONDUCTOR_ADDRESS, signedVaas, initiatorWallet(CONDUCTOR_NETWORK));
  if (receipts.length != signedVaas.length) {
    throw Error("missing contribution attestation VAA");
  }

  // confirm that all contributions were actually collected
  const conductorSale = await getSaleFromConductorOnEth(CONDUCTOR_ADDRESS, testProvider(CONDUCTOR_NETWORK), saleId);

  const isCollected: boolean[] = [];
  for (let i = 0; i < conductorSale.contributionsCollected.length; i++) {
    isCollected.push(conductorSale.contributionsCollected[i]);
  }
  return isCollected;
}

export async function sealSaleAndParseReceiptOnEth(
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  coreBridgeAddress: string,
  tokenBridgeAddress: string,
  wallet: ethers.Wallet
): Promise<SealSaleResult> {
  const receipt = await sealSaleOnEth(conductorAddress, saleId, wallet);
  console.log("Finished sealing the sale on the Conductor.");

  const sale = await getSaleFromConductorOnEth(conductorAddress, wallet.provider, saleId);
  const emitterChain = CONDUCTOR_CHAIN_ID as ChainId;

  const sequences = parseSequencesFromLogEth(receipt, coreBridgeAddress);
  const sealSaleSequence = sequences.pop();
  if (sealSaleSequence === undefined) {
    throw Error("no vaa sequences found");
  }

  // fetch the VAA
  const sealSaleVaa = await getSignedVaaFromSequence(
    emitterChain,
    getEmitterAddressEth(conductorAddress),
    sealSaleSequence
  );

  // search for allocations
  // doing it serially for ease of putting into the map
  const mapped = new Map<ChainId, Uint8Array[]>();
  if (sale.isSealed) {
    for (const sequence of sequences) {
      const signedVaa = await getSignedVaaFromSequence(
        emitterChain,
        getEmitterAddressEth(tokenBridgeAddress),
        sequence
      );
      const vaaPayload = await extractVaaPayload(signedVaa);
      const chainId = await getTargetChainIdFromTransferVaa(vaaPayload);

      const signedVaas = mapped.get(chainId);
      if (signedVaas === undefined) {
        mapped.set(chainId, [signedVaa]);
      } else {
        signedVaas.push(signedVaa);
      }
    }
  }
  return {
    sale: sale,
    transferVaas: mapped,
    sealSaleVaa: sealSaleVaa,
  };
}

export async function sealOrAbortSaleOnEth(saleInit: SaleInit): Promise<SealSaleResult> {
  const saleId = saleInit.saleId;
  console.log("Attempting to seal sale:", saleId);
  return sealSaleAndParseReceiptOnEth(
    CONDUCTOR_ADDRESS,
    saleId,
    WORMHOLE_ADDRESSES[CONDUCTOR_NETWORK].wormhole,
    WORMHOLE_ADDRESSES[CONDUCTOR_NETWORK].tokenBridge,
    initiatorWallet(CONDUCTOR_NETWORK)
  );
}

export async function redeemCrossChainAllocations(saleResult: SealSaleResult): Promise<ethers.ContractReceipt[][]> {
  // redeem transfers before calling saleSealed
  const transferVaas = saleResult.transferVaas;

  return Promise.all(
    CONTRIBUTOR_NETWORKS.map(async (network): Promise<ethers.ContractReceipt[]> => {
      const signedVaas = transferVaas.get(WORMHOLE_ADDRESSES[network].chainId);
      if (signedVaas === undefined) {
        return [];
      }
      const receipts: ethers.ContractReceipt[] = [];
      for (const signedVaa of signedVaas) {
        const receipt = await redeemOnEth(WORMHOLE_ADDRESSES[network].tokenBridge, initiatorWallet(network), signedVaa);
        receipts.push(receipt);
      }
      return receipts;
    })
  );
}

export async function sealSaleAtEthContributors(
  saleInit: SaleInit,
  saleResult: SealSaleResult
): Promise<[SaleSealed, Map<ChainId, ethers.ContractReceipt>]> {
  if (!saleResult.sale.isSealed) {
    throw Error("sale was not sealed");
  }

  const signedVaa = saleResult.sealSaleVaa;
  const vaaPayload = await extractVaaPayload(signedVaa);
  const saleSealed = await parseSaleSealed(vaaPayload);

  console.log(saleSealed);

  const receipts = new Map<ChainId, ethers.ContractReceipt>();
  for (let [chainId, network] of CHAIN_ID_TO_NETWORK) {
    const receipt = await saleSealedOnEth(
      TESTNET_ADDRESSES[network],
      signedVaa,
      initiatorWallet(network),
      saleInit.saleId
    );
    receipts.set(chainId, receipt);
  }

  return [saleSealed, receipts];
}

export async function claimContributorAllocationOnEth(
  saleSealed: SaleSealed,
  contribution: Contribution
): Promise<boolean> {
  const network = CHAIN_ID_TO_NETWORK.get(contribution.chainId);
  const saleId = saleSealed.saleId;
  const wallet = contributorWallet(contribution);
  const tokenIndex = await getTokenIndexFromConfig(contribution.chainId, contribution.address);

  if (!tokenIndex[0]) {
    return false;
  }

  let receipt;
  try {
    receipt = await claimAllocationOnEth(TESTNET_ADDRESSES[network], saleId, tokenIndex[1], wallet);
  } catch (error) {
    if (error.message.includes("allocation already claimed")) {
      return false;
    } else {
      console.log(error);
    }
  }

  return getAllocationIsClaimedOnEth(
    TESTNET_ADDRESSES[network],
    wallet.provider,
    saleId,
    tokenIndex[1],
    wallet.address
  );
}

export async function claimContributorExcessContributionOnEth(
  saleSealed: SaleSealed,
  contribution: Contribution
): Promise<boolean> {
  const network = CHAIN_ID_TO_NETWORK.get(contribution.chainId);
  const saleId = saleSealed.saleId;
  const wallet = contributorWallet(contribution);
  const tokenIndex = await getTokenIndexFromConfig(contribution.chainId, contribution.address);

  if (!tokenIndex[0]) {
    return false;
  }

  let receipt;
  try {
    receipt = await claimExcessContributionOnEth(TESTNET_ADDRESSES[network], saleId, tokenIndex[1], wallet);
  } catch (error) {
    if (error.message.includes("excess contribution already claimed")) {
      return false;
    } else {
      console.log(error);
    }
  }

  return getExcessContributionIsClaimedOnEth(
    TESTNET_ADDRESSES[network],
    wallet.provider,
    saleId,
    tokenIndex[1],
    wallet.address
  );
}

export async function excessContributionsExistForSale(
  saleId: ethers.BigNumberish,
  contribution: Contribution
): Promise<boolean> {
  const network = CHAIN_ID_TO_NETWORK.get(contribution.chainId);
  const wallet = contributorWallet(contribution);
  const tokenIndex = await getTokenIndexFromConfig(contribution.chainId, contribution.address);

  const saleExcessContribution = await getSaleExcessContributionOnEth(
    TESTNET_ADDRESSES[network],
    wallet.provider,
    saleId,
    tokenIndex[1]
  );

  return ethers.BigNumber.from(saleExcessContribution).gt(0);
}

export async function redeemCrossChainContributions(
  receipt: ethers.ContractReceipt,
  emitterChain: ChainId
): Promise<boolean> {
  const sequences = parseSequencesFromLogEth(
    receipt,
    WORMHOLE_ADDRESSES[CHAIN_ID_TO_NETWORK.get(emitterChain)].wormhole
  );

  const bridgeTransferSequence = sequences[sequences.length - 1];
  if (bridgeTransferSequence === undefined) {
    console.log("no vaa sequences found");
    return false;
  }

  for (const sequence of sequences) {
    const signedVaa = await getSignedVaaFromSequence(
      emitterChain,
      getEmitterAddressEth(WORMHOLE_ADDRESSES[CHAIN_ID_TO_NETWORK.get(emitterChain)].tokenBridge),
      sequence
    );
    const vaaPayload = await extractVaaPayload(signedVaa);
    const chainId = await getTargetChainIdFromTransferVaa(vaaPayload);
    const targetNetwork = CHAIN_ID_TO_NETWORK.get(chainId);

    console.log("Redeeming cross-chain transfer", sequence, "to recipient on chainId:", chainId);

    // redeem it on conductor chain
    const receipt = await redeemOnEth(
      WORMHOLE_ADDRESSES[targetNetwork].tokenBridge,
      initiatorWallet(targetNetwork),
      signedVaa
    );
  }
  return true;
}

export async function abortSaleEarlyAtConductor(saleInit: SaleInit): Promise<ethers.ContractReceipt> {
  const receipt = await abortSaleBeforeStartOnEth(
    CONDUCTOR_ADDRESS,
    saleInit.saleId,
    initiatorWallet(CONDUCTOR_NETWORK)
  );
  return receipt;
}

export async function abortSaleEarlyAtContributor(saleInit: SaleInit, abortEarlyReceipt: ethers.ContractReceipt) {
  const saleAbortedVaa = await getSignedVaaFromReceiptOnEth(
    CONDUCTOR_CHAIN_ID,
    CONDUCTOR_ADDRESS,
    abortEarlyReceipt,
    CONDUCTOR_NETWORK
  );

  // need to call sale aborted
  {
    const receipts = await Promise.all(
      CONTRIBUTOR_NETWORKS.map(async (network) => {
        return saleAbortedOnEth(TESTNET_ADDRESSES[network], saleAbortedVaa, initiatorWallet(network), saleInit.saleId);
      })
    );
  }

  return;
}

export async function abortSaleAtContributors(saleResult: SealSaleResult) {
  const signedVaa = saleResult.sealSaleVaa;
  const vaaPayload = await extractVaaPayload(signedVaa);
  const saleId = await getSaleIdFromIccoVaa(vaaPayload);

  {
    const receipts = await Promise.all(
      CONTRIBUTOR_NETWORKS.map(async (network): Promise<ethers.ContractReceipt> => {
        return saleAbortedOnEth(TESTNET_ADDRESSES[network], signedVaa, initiatorWallet(network), saleId);
      })
    );
  }

  return;
}

export async function getOriginalTokenBalance(
  nativeTokenAddress: string,
  nativeTokenChain: ChainId,
  walletAddress: string,
  walletChainId: ChainId
): Promise<ethers.BigNumber> {
  const walletNetwork = CHAIN_ID_TO_NETWORK.get(walletChainId);
  const tokenAddressBytes = tryNativeToUint8Array(nativeTokenAddress, nativeTokenChain);

  const originAssetAddress = await getForeignAssetEth(
    WORMHOLE_ADDRESSES[walletNetwork].tokenBridge,
    testProvider(walletNetwork),
    nativeTokenChain,
    tokenAddressBytes
  );

  const balance = await getErc20Balance(testProvider(walletNetwork), originAssetAddress, walletAddress);
  return balance;
}

export async function getSaleTokenBalancesOnContributors(
  nativeSaleTokenAddress: string,
  nativeSaleTokenChain: ChainId
): Promise<ethers.BigNumber[]> {
  return Promise.all(
    CONTRIBUTOR_NETWORKS.map(async (network): Promise<ethers.BigNumber> => {
      return getOriginalTokenBalance(
        nativeSaleTokenAddress,
        nativeSaleTokenChain,
        TESTNET_ADDRESSES[network],
        WORMHOLE_ADDRESSES[network].chainId
      );
    })
  );
}

export async function getContributedTokenBalancesOnContributors(
  acceptedTokens: AcceptedToken[]
): Promise<ethers.BigNumber[]> {
  const balances: ethers.BigNumber[] = [];

  for (const token of acceptedTokens) {
    const chainId = token.tokenChain as ChainId;
    const addressString = tryUint8ArrayToNative(token.tokenAddress as Uint8Array, chainId);
    const network = CHAIN_ID_TO_NETWORK.get(chainId);
    const balance = await getErc20Balance(testProvider(network), addressString, TESTNET_ADDRESSES[network]);
    balances.push(balance);
  }
  return balances;
}

export async function getRecipientContributedTokenBalances(
  recipientAddress: string,
  acceptedTokens: AcceptedToken[]
): Promise<ethers.BigNumber[]> {
  const balances: ethers.BigNumber[] = [];

  // doing this serially since order matters
  for (const token of acceptedTokens) {
    const tokenChainId = token.tokenChain as ChainId;

    let tokenAddressOnConductorChain;
    if (tokenChainId === (CONDUCTOR_CHAIN_ID as ChainId)) {
      tokenAddressOnConductorChain = tryUint8ArrayToNative(token.tokenAddress as Uint8Array, tokenChainId);
    } else {
      const network = CHAIN_ID_TO_NETWORK.get(tokenChainId);
      const nativeTokenAddress = tryUint8ArrayToNative(token.tokenAddress as Uint8Array, tokenChainId);

      // get the original token address of the wrapped token
      const originalToken = await getOriginalAssetEth(
        WORMHOLE_ADDRESSES[network].tokenBridge,
        testProvider(network),
        nativeTokenAddress,
        tokenChainId
      );

      if (originalToken.chainId === CONDUCTOR_CHAIN_ID) {
        tokenAddressOnConductorChain = tryUint8ArrayToNative(originalToken.assetAddress, originalToken.chainId);
      } else {
        // fetch the foreign asset address
        tokenAddressOnConductorChain = await getForeignAssetEth(
          WORMHOLE_ADDRESSES[CONDUCTOR_NETWORK].tokenBridge,
          testProvider(CONDUCTOR_NETWORK),
          originalToken.chainId,
          originalToken.assetAddress
        );
      }
    }
    balances.push(
      await getErc20Balance(testProvider(CONDUCTOR_NETWORK), tokenAddressOnConductorChain, recipientAddress)
    );
  }

  return balances;
}

export function findUniqueContributions(
  contributions: Contribution[],
  acceptedTokens: AcceptedToken[]
): Contribution[] {
  // create map to record which contributions were already accounted for
  // only count 1 tokenIndex per wallet address
  const recordedContributions: Map<number, string[]> = new Map<number, string[]>();
  const uniqueContributions: Contribution[] = [];

  for (let i = 0; i < acceptedTokens.length; i++) {
    const acceptedAddress = ethers.utils.hexlify(acceptedTokens[i].tokenAddress).substring(2);

    for (const contribution of contributions) {
      const contributionAddress = tryNativeToHexString(contribution.address, contribution.chainId);

      if (contributionAddress === acceptedAddress) {
        if (!recordedContributions.has(i)) {
          const walletArray: string[] = [contribution.key];
          recordedContributions.set(i, walletArray);

          // add the unique contribution
          uniqueContributions.push(contribution);
        } else {
          const walletArray = recordedContributions.get(i);
          if (!walletArray.includes(contribution.key)) {
            walletArray.push(contribution.key);
            recordedContributions.set(i, walletArray);

            // add the unique contribution
            uniqueContributions.push(contribution);
          }
        }
      }
    }
  }
  return uniqueContributions;
}

export async function attestMintFromSolana(
  connection: web3.Connection,
  sender: web3.Keypair,
  mint: web3.PublicKey
): Promise<web3.TransactionResponse> {
  const transaction = await attestFromSolana(
    connection,
    SOLANA_CORE_BRIDGE_ADDRESS.toString(),
    SOLANA_TOKEN_BRIDGE_ADDRESS.toString(),
    sender.publicKey.toString(),
    mint.toString()
  );

  transaction.partialSign(sender);
  const tx = await connection.sendRawTransaction(transaction.serialize());

  // confirm
  while (true) {
    const result = await connection.confirmTransaction(tx);
    if (result.value.err == null) {
      break;
    }
    console.log("attempting confirmTransaction again");
  }

  // return response
  return connection.getTransaction(tx);
}

export async function transferFromSolanaToEvm(
  connection: web3.Connection,
  sender: web3.Keypair,
  mint: web3.PublicKey,
  amount: bigint,
  recipientChain: ChainId,
  recipientAddress: string
): Promise<web3.TransactionResponse> {
  const tokenAccount = await getAssociatedTokenAddress(mint, sender.publicKey);
  const transaction = await transferFromSolana(
    connection,
    SOLANA_CORE_BRIDGE_ADDRESS.toString(),
    SOLANA_TOKEN_BRIDGE_ADDRESS.toString(),
    sender.publicKey.toString(),
    tokenAccount.toString(),
    mint.toString(),
    amount,
    tryNativeToUint8Array(recipientAddress, recipientChain),
    recipientChain
  );

  transaction.partialSign(sender);
  const tx = await connection.sendRawTransaction(transaction.serialize());

  // confirm
  while (true) {
    const result = await connection.confirmTransaction(tx);
    if (result.value.err == null) {
      break;
    }
    console.log("attempting confirmTransaction again");
  }

  // return response
  return connection.getTransaction(tx);
}

export async function getSignedVaaFromSolanaTokenBridge(sequence: string) {
  const emitterAddress = await getEmitterAddressSolana(SOLANA_TOKEN_BRIDGE_ADDRESS.toString());
  const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
    WORMHOLE_RPCS,
    CHAIN_ID_SOLANA,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );
  return signedVaa;
}

export async function getSignedVaaFromAvaxTokenBridge(sequence: string) {
  const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
    WORMHOLE_RPCS,
    CHAIN_ID_AVAX,
    getEmitterAddressEth(AVAX_TOKEN_BRIDGE_ADDRESS),
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );
  return signedVaa;
}

export async function postAndRedeemTransferVaa(
  connection: web3.Connection,
  payer: web3.Keypair,
  signedVaa: Uint8Array
) {
  await postVaaSolanaWithRetry(
    connection,
    async (tx) => {
      tx.partialSign(payer);
      return tx;
    },
    SOLANA_CORE_BRIDGE_ADDRESS.toString(),
    payer.publicKey.toString(),
    Buffer.from(signedVaa),
    10
  );

  const transaction = await redeemOnSolana(
    connection,
    SOLANA_CORE_BRIDGE_ADDRESS.toString(),
    SOLANA_TOKEN_BRIDGE_ADDRESS.toString(),
    payer.publicKey.toString(),
    signedVaa
  );
  transaction.partialSign(payer);
  return connection.sendRawTransaction(transaction.serialize());
}

export async function waitUntilSolanaBlock(connection: web3.Connection, expiration: number) {
  let blockTime = await getBlockTime(connection);
  console.log("start waiting", blockTime, expiration, "diff", expiration - blockTime);
  while (blockTime <= expiration) {
    console.log("waiting", blockTime, expiration, "diff", expiration - blockTime);
    await wait(1);
    blockTime = await getBlockTime(connection);
  }
}
