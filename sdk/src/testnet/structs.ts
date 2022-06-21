import { ConductorSale } from "../../src";
import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export interface SaleParams {
  isFixedPrice: boolean;
  token: string;
  localTokenAddress: string;
  tokenAmount: string;
  tokenChain: ChainId;
  tokenDecimals: number;
  minRaise: string;
  maxRaise: string;
  recipient: string;
  refundRecipient: string;
  saleDurationSeconds: number;
  lockUpDurationSeconds: number;
  saleStartTimer: number;
  solanaTokenAccount: string;
  authority: string;
}

export interface TokenConfig {
  chainId: ChainId;
  address: string;
  conversionRate: string;
}

export interface Contribution {
  chainId: ChainId;
  address: string;
  amount: string;
  key: string;
}

export interface SealSaleResult {
  sale: ConductorSale;
  transferVaas: Map<ChainId, Uint8Array[]>;
  sealSaleVaa: Uint8Array;
}

export interface ConductorDecimals {
  chainId: ChainId;
  tokenBridgeAddress: string;
  provider: ethers.providers.Provider;
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
