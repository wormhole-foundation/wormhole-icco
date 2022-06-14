import {
  ChainId,
  CHAIN_ID_SOLANA,
  ERC20__factory,
  getForeignAssetEth,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
  uint8ArrayToHex,
} from "@certusone/wormhole-sdk";
import { getForeignAssetSolana } from "@certusone/wormhole-sdk";
import { BN, web3 } from "@project-serum/anchor";
import { ethers } from "ethers";
import { AcceptedToken, Raise } from "./icco";
import { getCurrentTime } from "./testnet/utils";

export class SaleParameters {
  // conductor
  conductorChain: ChainId;

  // for accepted token conversion rate calculations
  precision: number;
  denominationDecimals: number;

  // parameters
  raise: Raise;
  acceptedTokens: AcceptedToken[];
  tokenChain: ChainId;
  tokenAddress: string;

  constructor(conductorChain: ChainId, denominationDecimals: number) {
    this.conductorChain = conductorChain;
    this.denominationDecimals = denominationDecimals;
    this.acceptedTokens = [];

    this.precision = 18;
  }

  setSaleToken(chain: ChainId, address: string) {
    this.tokenChain = chain;
    this.tokenAddress = address;
  }

  prepareRaise(
    isFixedPrice: boolean,
    tokenAmount: string,
    recipient: string,
    refundRecipient: string,
    minRaise: string,
    maxRaise: string,
    custodianSaleTokenAccount: web3.PublicKey,
    authority: string
  ) {
    // TODO: handle raise stuff
    this.raise = {
      isFixedPrice,
      token: tryNativeToUint8Array(this.tokenAddress, this.tokenChain),
      tokenAmount: tokenAmount,
      tokenChain: this.tokenChain,
      minRaise,
      maxRaise,
      saleStart: 0, // placeholder
      saleEnd: 0, // placeholder
      unlockTimestamp: 0, // placeholder
      recipient,
      refundRecipient,
      solanaTokenAccount: tryNativeToUint8Array(custodianSaleTokenAccount.toString(), CHAIN_ID_SOLANA),
      authority,
    };
  }

  saleTokenAsArray() {
    return tryNativeToUint8Array(this.tokenAddress, this.tokenChain);
  }

  async saleTokenSolanaMint(connection?: web3.Connection, solanaTokenBridge?: string) {
    if (this.tokenChain == CHAIN_ID_SOLANA) {
      return new web3.PublicKey(this.tokenAddress);
    }

    const wrapped = await getForeignAssetSolana(
      connection,
      solanaTokenBridge,
      this.tokenChain,
      this.saleTokenAsArray()
    );
    return new web3.PublicKey(wrapped);
  }

  async saleTokenEvm(connection: ethers.providers.Provider, tokenBridge: string) {
    const wrapped = await getForeignAssetEth(tokenBridge, connection, this.tokenChain, this.saleTokenAsArray());

    return ERC20__factory.connect(wrapped, connection);
  }

  makeRaiseNow(startDelay: number, saleDuration: number, unlockPeriod: number) {
    this.raise.saleStart = getCurrentTime() + startDelay;
    this.raise.saleEnd = this.raise.saleStart + saleDuration;
    this.raise.unlockTimestamp = this.raise.saleEnd + unlockPeriod;
    return this.raise;
  }

  addAcceptedToken(chain: ChainId, address: string, priceConversion: string, nativeDecimals: number) {
    // we need to ensure that amounts will add up to the same units as the denomination
    // of the raise
    const normalization = this.denominationDecimals + this.precision - nativeDecimals;

    this.acceptedTokens.push({
      tokenAddress: tryNativeToUint8Array(address, chain),
      tokenChain: chain as number,
      conversionRate: ethers.utils.parseUnits(priceConversion, normalization).toString(),
    });
  }
}

export function parseIccoHeader(iccoSignedVaa: Buffer): [number, Buffer] {
  const numSigners = iccoSignedVaa[5];
  const payloadStart = 57 + 66 * numSigners;
  return [iccoSignedVaa[payloadStart], iccoSignedVaa.subarray(payloadStart + 1, payloadStart + 33)];
}

export function bytesLikeToHex(byteslike: ethers.BytesLike) {
  return uint8ArrayToHex(ethers.utils.arrayify(byteslike));
}

export function unitsToUintString(value: string, decimals: number) {
  return ethers.utils.parseUnits(value, decimals).toString();
}

export function unitsToUint(value: string, decimals: number) {
  return new BN(unitsToUintString(value, decimals));
}
