import {
  ChainId,
  CHAIN_ID_SOLANA,
  ERC20__factory,
  getForeignAssetEth,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { getForeignAssetSolana } from "@certusone/wormhole-sdk";
import { web3 } from "@project-serum/anchor";
import { ethers } from "ethers";
import { AcceptedToken, Raise } from "./icco";
import { getCurrentTime } from "./testnet/utils";

// interface SaleConfig {
//   isFixedPrice: boolean;
//   token: string;
//   // localTokenAddress: string;
//   tokenAmount: string;
//   tokenChain: ChainId;
//   tokenDecimals: number;
//   minRaise: string;
//   maxRaise: string;
//   recipient: string;
//   refundRecipient: string;
//   saleDurationSeconds: number;
//   lockUpDurationSeconds: number;
//   saleStartTimer: number;
//   solanaTokenAccount: string;
//   authority: string;
// }

export class SaleParameters {
  // conductor
  conductorChain: ChainId;

  // parameters
  raise: Raise;
  acceptedTokens: AcceptedToken[];
  tokenChain: ChainId;
  tokenAddress: string;

  // TODO: use Drew's calculator here
  calculator: DummyCalculator;

  constructor(conductorChain: ChainId) {
    this.conductorChain = conductorChain;
    this.acceptedTokens = [];

    //
    this.calculator = new DummyCalculator();
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

  addAcceptedToken(chain: ChainId, address: string, conversion: string) {
    this.acceptedTokens.push({
      tokenAddress: tryNativeToUint8Array(address, chain),
      tokenChain: chain as number,
      conversionRate: this.calculator.normalize(chain, this.conductorChain, conversion),
    });
  }
}

class DummyCalculator {
  normalize(fromChain: ChainId, toChain: ChainId, conversion: string) {
    return conversion;
  }
}

export function parseIccoHeader(iccoSignedVaa: Buffer): [number, Buffer] {
  const numSigners = iccoSignedVaa[5];
  const payloadStart = 57 + 66 * numSigners;
  return [iccoSignedVaa[payloadStart], iccoSignedVaa.subarray(payloadStart + 1, payloadStart + 33)];
}
