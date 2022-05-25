import { ethers } from "ethers";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  ChainId,
  ERC20__factory,
  parseSequencesFromLogEth,
  getSignedVAAWithRetry,
  getEmitterAddressEth,
  nativeToHexString,
  importCoreWasm,
  redeemOnEth,
  CHAIN_ID_ETH,
} from "@certusone/wormhole-sdk";
import {
  AcceptedToken,
  makeAcceptedToken,
  initSaleOnEth,
  createSaleOnEth,
  getCurrentBlock,
  sleepFor,
  secureContributeOnEth,
  parseSaleInit,
  SaleInit,
  attestContributionsOnEth,
  collectContributionsOnEth,
  sealSaleOnEth,
  getSaleFromConductorOnEth,
  getTargetChainIdFromTransferVaa,
  parseSaleSealed,
  saleSealedOnEth,
  normalizeConversionRate,
  getAcceptedTokenDecimalsOnConductor,
  getErc20Decimals,
  claimAllocationOnEth,
  getAllocationIsClaimedOnEth,
  getSaleContributionOnEth,
  nativeToUint8Array,
  abortSaleBeforeStartOnEth,
  saleAbortedOnEth,
  getSaleIdFromIccoVaa,
} from "wormhole-icco-sdk";
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
  RETRY_TIMEOUT_SECONDS,
} from "./consts";
import {
  TokenConfig,
  Contribution,
  SealSaleResult,
  saleParams,
  SaleSealed,
} from "./structs";
import { signContribution } from "./kyc";
import { assert } from "console";

export async function extractVaaPayload(
  signedVaa: Uint8Array
): Promise<Uint8Array> {
  const { parse_vaa } = await importCoreWasm();
  const { payload: payload } = parse_vaa(signedVaa);
  return payload;
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
  const wallet: ethers.Wallet = new ethers.Wallet(
    SALE_CONFIG["initiatorWallet"][network].key,
    provider
  );
  return wallet;
}

export function contributorWallet(contribution: Contribution): ethers.Wallet {
  const provider = testProvider(CHAIN_ID_TO_NETWORK.get(contribution.chainId));
  const wallet: ethers.Wallet = new ethers.Wallet(contribution.key, provider);
  return wallet;
}

export async function buildAcceptedTokens(
  tokenConfig: TokenConfig[]
): Promise<AcceptedToken[]> {
  const acceptedTokens: AcceptedToken[] = [];

  for (const config of tokenConfig) {
    const wallet = initiatorWallet(CHAIN_ID_TO_NETWORK.get(config.chainId));
    const token = ERC20__factory.connect(config.address, wallet);
    const tokenDecimals = await token.decimals();
    const network = CHAIN_ID_TO_NETWORK.get(config.chainId);

    // compute the normalized conversionRate
    const acceptedTokenDecimalsOnConductor =
      await getAcceptedTokenDecimalsOnConductor(
        config.chainId,
        CONDUCTOR_CHAIN_ID,
        WORMHOLE_ADDRESSES[network].tokenBridge,
        WORMHOLE_ADDRESSES[CONDUCTOR_NETWORK].tokenBridge,
        testProvider(network),
        testProvider(CONDUCTOR_NETWORK),
        config.address,
        tokenDecimals
      );

    const normalizedConversionRate = await normalizeConversionRate(
      SALE_CONFIG.denominationDecimals,
      tokenDecimals,
      config.conversionRate,
      acceptedTokenDecimalsOnConductor
    );

    acceptedTokens.push(
      makeAcceptedToken(
        config.chainId,
        config.address,
        normalizedConversionRate
      )
    );
  }
  return acceptedTokens;
}

export function parseSequencesFromEthReceipt(
  receipt: ethers.ContractReceipt,
  network: string
): string[] {
  return parseSequencesFromLogEth(
    receipt,
    WORMHOLE_ADDRESSES[network].wormhole
  );
}

export async function getSignedVaaFromSequence(
  chainId: ChainId,
  emitterAddress: string,
  sequence: string
): Promise<Uint8Array> {
  console.log("Searching for VAA with sequence:", sequence);
  const result = await getSignedVAAWithRetry(
    WORMHOLE_ADDRESSES.guardianRpc,
    chainId,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    },
    RETRY_TIMEOUT_SECONDS
  );
  console.log("Found VAA for sequence:", sequence);
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

  return getSignedVaaFromSequence(
    chainId,
    getEmitterAddressEth(contractAddress),
    sequences[0]
  );
}

export async function createSaleOnEthAndGetVaa(
  seller: ethers.Wallet,
  conductorAddress: string,
  chainId: ChainId,
  localTokenAddress: string,
  saleTokenAddress: string,
  saleTokenChain: ChainId,
  amount: ethers.BigNumberish,
  minRaise: ethers.BigNumberish,
  maxRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  recipientAddress,
  refundRecipientAddress,
  acceptedTokens: AcceptedToken[],
  solanaTokenAccount: ethers.BytesLike
): Promise<Uint8Array> {
  // create
  const receipt = await createSaleOnEth(
    conductorAddress,
    localTokenAddress,
    saleTokenAddress,
    saleTokenChain,
    amount,
    minRaise,
    maxRaise,
    saleStart,
    saleEnd,
    acceptedTokens,
    solanaTokenAccount,
    recipientAddress,
    refundRecipientAddress,
    seller
  );

  return getSignedVaaFromReceiptOnEth(
    chainId,
    conductorAddress,
    receipt,
    CONDUCTOR_NETWORK
  );
}

export async function createSaleOnEthAndInit(
  initiatorConductorWallet: ethers.Wallet,
  conductorAddress: string,
  conductorChainId: ChainId,
  raiseParams: saleParams,
  acceptedTokens: AcceptedToken[]
): Promise<SaleInit> {
  // fetch localToken decimals
  const decimals = await getErc20Decimals(
    testProvider(CONDUCTOR_NETWORK),
    raiseParams.localTokenAddress
  );

  // set up sale token contract to interact with
  const saleStart = getCurrentTime() + raiseParams.saleStartTimer;
  const saleEnd = saleStart + raiseParams.saleDurationSeconds;

  // create fake solana ATA
  const solanaTokenAccount = nativeToUint8Array(
    raiseParams.localTokenAddress,
    CHAIN_ID_ETH // will be CHAIN_ID_SOLANA with a real token
  );

  // create the sale
  const saleInitVaa = await createSaleOnEthAndGetVaa(
    initiatorConductorWallet,
    conductorAddress,
    conductorChainId,
    raiseParams.localTokenAddress,
    raiseParams.token,
    raiseParams.tokenChain,
    ethers.utils.parseUnits(raiseParams.tokenAmount, decimals),
    ethers.utils.parseUnits(
      raiseParams.minRaise,
      SALE_CONFIG.denominationDecimals
    ),
    ethers.utils.parseUnits(
      raiseParams.maxRaise,
      SALE_CONFIG.denominationDecimals
    ),
    saleStart,
    saleEnd,
    raiseParams.recipient,
    raiseParams.refundRecipient,
    acceptedTokens,
    solanaTokenAccount
  );

  // parse the sale init payload for return value
  const saleInitPayload = await extractVaaPayload(saleInitVaa);
  const saleInit = await parseSaleInit(saleInitPayload);

  {
    const receipts = await Promise.all(
      CONTRIBUTOR_NETWORKS.map(
        async (network): Promise<ethers.ContractReceipt> => {
          return initSaleOnEth(
            TESTNET_ADDRESSES[network],
            saleInitVaa,
            initiatorWallet(network)
          );
        }
      )
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
  console.log("Earliest block timestamp:", timeNow);
  console.log("SaleInit endTime:", saleInit.saleEnd);
  const timeLeftForSale = Number(saleInit.saleEnd) - timeNow;
  if (timeLeftForSale > 0) {
    console.log("Sleeping for", timeLeftForSale + extraTime, "seconds");
    await sleepFor((timeLeftForSale + extraTime) * 1000);
  }
  return;
}

export async function getTokenIndexFromConfig(
  chainId: ChainId,
  address: string
): Promise<[boolean, number]> {
  const acceptedTokens: TokenConfig[] = SALE_CONFIG["acceptedTokens"];
  for (let i = 0; i < acceptedTokens.length; i++) {
    if (
      chainId === acceptedTokens[i].chainId &&
      address === acceptedTokens[i].address
    ) {
      return [true, i];
    }
  }
  // return 0 if token isn't found
  return [false, 0];
}

export async function parseUnits(
  contribution: Contribution,
  wallet: ethers.Wallet
): Promise<ethers.BigNumberish> {
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

  const indexInfo = await getTokenIndexFromConfig(
    contribution.chainId,
    contribution.address
  );

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
  console.log("Contributing this amount:", amount.toString());

  // get total contributed amount for kyc authority
  const totalContribution = await getSaleContributionOnEth(
    TESTNET_ADDRESSES[network],
    wallet.provider,
    saleId,
    tokenIndex,
    wallet.address
  );

  // get KYC signature
  const signature = await signContribution(
    testRpc(CHAIN_ID_TO_NETWORK.get(contribution.chainId)),
    nativeToHexString(CONDUCTOR_ADDRESS, contribution.chainId)!,
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
    console.error(error);
    return false;
  }
  return true;
}

export async function attestAndCollectContributions(
  saleInit: SaleInit
): Promise<void> {
  const saleId = saleInit.saleId;

  const signedVaas = await Promise.all(
    CONTRIBUTOR_NETWORKS.map(async (network): Promise<Uint8Array> => {
      const receipt = await attestContributionsOnEth(
        TESTNET_ADDRESSES[network],
        saleId,
        initiatorWallet(network)
      );
      console.log("Attested contribution for", network);

      return getSignedVaaFromReceiptOnEth(
        WORMHOLE_ADDRESSES[network].chainId,
        TESTNET_ADDRESSES[network],
        receipt,
        network
      );
    })
  );

  console.info("Finished attesting contributions.");

  {
    const receipts = await collectContributionsOnEth(
      CONDUCTOR_ADDRESS,
      signedVaas,
      initiatorWallet(CONDUCTOR_NETWORK)
    );
    assert(receipts.length == signedVaas.length);
  }
  console.info("Finished collecting contributions.");

  // confirm that all contributions were actually collected
  const conductorSale = await getSaleFromConductorOnEth(
    CONDUCTOR_ADDRESS,
    testProvider(CONDUCTOR_NETWORK),
    saleInit.saleId
  );

  for (let i = 0; i < conductorSale.contributionsCollected.length; i++) {
    console.log(
      "Contribution",
      i,
      "was accepted:",
      conductorSale.contributionsCollected[i]
    );
  }

  return;
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

  const sale = await getSaleFromConductorOnEth(
    conductorAddress,
    wallet.provider,
    saleId
  );
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
  console.log("Found the sealSale VAA emitted from the Conductor.");

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

export async function sealOrAbortSaleOnEth(
  saleInit: SaleInit
): Promise<SealSaleResult> {
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

export async function redeemCrossChainAllocations(
  saleResult: SealSaleResult
): Promise<ethers.ContractReceipt[][]> {
  // redeem transfers before calling saleSealed
  const transferVaas = saleResult.transferVaas;

  return Promise.all(
    CONTRIBUTOR_NETWORKS.map(
      async (network): Promise<ethers.ContractReceipt[]> => {
        const signedVaas = transferVaas.get(
          WORMHOLE_ADDRESSES[network].chainId
        );
        if (signedVaas === undefined) {
          return [];
        }
        const receipts: ethers.ContractReceipt[] = [];
        for (const signedVaa of signedVaas) {
          const receipt = await redeemOnEth(
            WORMHOLE_ADDRESSES[network].tokenBridge,
            initiatorWallet(network),
            signedVaa
          );
          receipts.push(receipt);
        }
        return receipts;
      }
    )
  );
}

export async function sealSaleAtContributors(
  saleInit: SaleInit,
  saleResult: SealSaleResult
): Promise<[SaleSealed, Map<ChainId, ethers.ContractReceipt>]> {
  if (!saleResult.sale.isSealed) {
    throw Error("sale was not sealed");
  }

  const signedVaa = saleResult.sealSaleVaa;
  const vaaPayload = await extractVaaPayload(signedVaa);
  const saleSealed = await parseSaleSealed(vaaPayload);

  console.log("Sealing sale at the contributors.");
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
  const tokenIndex = await getTokenIndexFromConfig(
    contribution.chainId,
    contribution.address
  );

  if (!tokenIndex[0]) {
    return false;
  }

  let receipt;
  try {
    receipt = await claimAllocationOnEth(
      TESTNET_ADDRESSES[network],
      saleId,
      tokenIndex[1],
      wallet
    );
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
      getEmitterAddressEth(
        WORMHOLE_ADDRESSES[CHAIN_ID_TO_NETWORK.get(emitterChain)].tokenBridge
      ),
      sequence
    );
    const vaaPayload = await extractVaaPayload(signedVaa);
    const chainId = await getTargetChainIdFromTransferVaa(vaaPayload);
    const targetNetwork = CHAIN_ID_TO_NETWORK.get(chainId);

    console.log(
      "Redeeming cross-chain transfer",
      sequence,
      "to recipient on chainId:",
      chainId
    );

    // redeem it on conductor chain
    const receipt = await redeemOnEth(
      WORMHOLE_ADDRESSES[targetNetwork].tokenBridge,
      initiatorWallet(targetNetwork),
      signedVaa
    );
  }
  return true;
}

export async function abortSaleEarlyAtConductor(
  saleInit: SaleInit
): Promise<ethers.ContractReceipt> {
  const receipt = await abortSaleBeforeStartOnEth(
    CONDUCTOR_ADDRESS,
    saleInit.saleId,
    initiatorWallet(CONDUCTOR_NETWORK)
  );
  return receipt;
}

export async function abortSaleEarlyAtContributor(
  saleInit: SaleInit,
  abortEarlyReceipt: ethers.ContractReceipt
) {
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
        return saleAbortedOnEth(
          TESTNET_ADDRESSES[network],
          saleAbortedVaa,
          initiatorWallet(network),
          saleInit.saleId
        );
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
      CONTRIBUTOR_NETWORKS.map(
        async (network): Promise<ethers.ContractReceipt> => {
          return saleAbortedOnEth(
            TESTNET_ADDRESSES[network],
            signedVaa,
            initiatorWallet(network),
            saleId
          );
        }
      )
    );
  }

  return;
}
