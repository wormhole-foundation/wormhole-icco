import { ethers } from "ethers";
import { ChainId } from "@certusone/wormhole-sdk";

import { nativeToUint8Array } from "./misc";

export interface Raise {
  token: ethers.BytesLike;
  tokenChain: ChainId;
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  maxRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  recipient: string;
  refundRecipient: string;
  solanaTokenAccount: ethers.BytesLike;
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
  contributions: ethers.BigNumberish[];
  contributionsCollected: boolean[];
  refundIsClaimed: boolean;
}

export interface ContributorSale extends Sale {
  tokenDecimals: number;
  solanaTokenAccount: ethers.BytesLike;
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
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  maxRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  acceptedTokens: AcceptedToken[];
  solanaTokenAccount: ethers.BytesLike;
  recipient: string;
  refundRecipient: string;
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

export function makeAcceptedToken(
  chainId: ChainId,
  address: string,
  conversion: ethers.BigNumberish
): AcceptedToken {
  return {
    tokenChain: chainId,
    tokenAddress: nativeToUint8Array(address, chainId),
    conversionRate: conversion,
  };
}
