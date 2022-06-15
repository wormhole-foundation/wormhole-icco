import { ethers } from "ethers";
import { ChainId } from "@certusone/wormhole-sdk";

import { nativeToUint8Array } from "./misc";

export interface Raise {
  isFixedPrice: boolean;
  token: ethers.BytesLike;
  tokenChain: ChainId;
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  maxRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  unlockTimestamp: ethers.BigNumberish;
  recipient: string;
  refundRecipient: string;
  solanaTokenAccount: ethers.BytesLike;
  authority: string;
}

export interface Sale {
  // sale init
  saleId: ethers.BigNumberish;
  tokenAddress: ethers.BytesLike;
  tokenChain: number;
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  maxRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  recipient: ethers.BytesLike;
  refundRecipient: ethers.BytesLike;
  // accepted tokens
  acceptedTokensChains: number[];
  acceptedTokensAddresses: ethers.BytesLike[];
  acceptedTokensConversionRates: ethers.BigNumberish[];
  // state
  isSealed: boolean;
  isAborted: boolean;
}

export interface ConductorSale extends Sale {
  initiator: string;
  localTokenDecimals: number;
  localTokenAddress: string;
  solanaTokenAccount: ethers.BytesLike;
  solanaAcceptedTokensCount: number;
  contributions: ethers.BigNumberish[];
  contributionsCollected: boolean[];
}

export interface ContributorSale {
  // sale init
  saleId: ethers.BigNumberish;
  tokenAddress: ethers.BytesLike;
  tokenChain: number;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  recipient: ethers.BytesLike;
  // accepted tokens
  acceptedTokensChains: number[];
  acceptedTokensAddresses: ethers.BytesLike[];
  acceptedTokensConversionRates: ethers.BigNumberish[];
  // state
  isSealed: boolean;
  isAborted: boolean;
  // yep
  tokenDecimals: number;
  allocations: ethers.BigNumberish[];
  excessContributions: ethers.BigNumberish[];
}

export interface AcceptedToken {
  tokenAddress: ethers.BytesLike;
  tokenChain: ethers.BigNumberish;
  conversionRate: ethers.BigNumberish;
}

export interface SaleInit {
  payloadId: number;
  saleId: ethers.BigNumberish;
  tokenAddress: string;
  tokenChain: number;
  tokenDecimals: number;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  acceptedTokens: AcceptedToken[];
  recipient: string;
  authority: string;
  unlockTimestamp: ethers.BigNumberish;
}

export interface SolanaToken {
  tokenIndex: number;
  tokenAddress: ethers.BytesLike;
}

export interface SolanaSaleInit {
  payloadId: number;
  saleId: ethers.BigNumberish;
  solanaTokenAccount: ethers.BytesLike;
  tokenChain: number;
  tokenDecimals: number;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  acceptedTokens: SolanaToken[];
  recipient: string;
}

export interface Allocation {
  tokenIndex: number;
  allocation: ethers.BigNumberish;
  excessContribution: ethers.BigNumberish;
}

export interface SaleSealed {
  payloadId: number;
  saleId: ethers.BigNumberish;
  allocations: Allocation[];
}

export function makeAcceptedToken(chainId: ChainId, address: string, conversion: ethers.BigNumberish): AcceptedToken {
  return {
    tokenChain: chainId,
    tokenAddress: nativeToUint8Array(address, chainId),
    conversionRate: conversion,
  };
}
