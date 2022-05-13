import { ConductorSale } from "wormhole-icco-sdk";
import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export interface saleParams {
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
  saleStartTimer: number; // swap out for sale startTime in mainnet
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
