import { ethers } from "ethers";
import { ChainId } from "..";
import { nativeToUint8Array } from "./misc";

export interface Raise {
    token: string;
    tokenAmount: ethers.BigNumberish;
    minRaise: ethers.BigNumberish;
    maxRaise: ethers.BigNumberish;
    saleStart: ethers.BigNumberish;
    saleEnd: ethers.BigNumberish;
    recipient: string;
    refundRecipient: string;
};

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
  contributions: ethers.BigNumberish[];
  contributionsCollected: boolean[];
  refundIsClaimed: boolean;
}

export interface ContributorSale extends Sale {
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
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  maxRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  acceptedTokens: AcceptedToken[];
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
  conversion: string
): AcceptedToken {
  return {
    tokenChain: chainId,
    tokenAddress: nativeToUint8Array(address, chainId),
    conversionRate: ethers.utils.parseUnits(conversion), // always 1e18
  };
}
