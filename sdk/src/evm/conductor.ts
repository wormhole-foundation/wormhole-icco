import {
  ChainId,
  ChainName,
  CHAIN_ID_SOLANA,
  getEmitterAddressEth,
  getForeignAssetEth,
  hexToUint8Array,
  parseSequenceFromLogEth,
} from "@certusone/wormhole-sdk";
import { GetSignedVAAResponse } from "@certusone/wormhole-sdk/lib/cjs/proto/publicrpc/v1/publicrpc";
import { web3 } from "@project-serum/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { ethers } from "ethers";
import { hexToPublicKey } from "../anchor/utils";
import { Conductor, Conductor__factory, ERC20__factory } from "../ethers-contracts";
import { AcceptedToken, ConductorSale, Raise } from "../icco";
import { bytesLikeToHex } from "../utils";

export class IccoConductor {
  contract: Conductor;
  chain: ChainId;
  wormhole: string;
  tokenBridge: string;

  constructor(address: string, chain: ChainId, signer: ethers.Wallet, wormhole: string, tokenBridge: string) {
    this.contract = Conductor__factory.connect(address, signer);
    this.chain = chain;
    this.wormhole = wormhole;
    this.tokenBridge = tokenBridge;
  }

  address() {
    return this.contract.address;
  }

  emitterAddress() {
    return getEmitterAddressEth(this.address());
  }

  signer() {
    return this.contract.signer;
  }

  provider() {
    return this.contract.provider;
  }

  async createSale(
    raise: Raise,
    acceptedTokens: AcceptedToken[],
    solanaConnection?: web3.Connection,
    payer?: web3.Keypair,
    custodian?: web3.PublicKey
  ) {
    // create associated token accounts for custodian
    {
      for (const token of acceptedTokens) {
        if (token.tokenChain == CHAIN_ID_SOLANA) {
          const mint = hexToPublicKey(bytesLikeToHex(token.tokenAddress));
          await getOrCreateAssociatedTokenAccount(
            solanaConnection,
            payer,
            mint,
            custodian,
            true // allowOwnerOffCurve
          );
        }
      }
    }

    const contract = this.contract;

    // approve of spending token that exists on this chain
    {
      const wrapped = await getForeignAssetEth(
        this.tokenBridge,
        this.provider(),
        raise.tokenChain,
        ethers.utils.arrayify(raise.token)
      );
      const token = ERC20__factory.connect(wrapped, this.signer());
      const receipt = await token.approve(this.address(), raise.tokenAmount).then((tx) => tx.wait());
    }

    // now create
    return contract.createSale(raise, acceptedTokens).then((tx) => tx.wait());
  }

  async getSale(saleId: ethers.BigNumber): Promise<ConductorSale> {
    const sale = await this.contract.sales(saleId);

    return {
      saleId: sale.saleID,
      tokenAddress: sale.tokenAddress,
      tokenChain: sale.tokenChain,
      localTokenDecimals: sale.localTokenDecimals,
      localTokenAddress: sale.localTokenAddress,
      solanaTokenAccount: sale.solanaTokenAccount,
      tokenAmount: sale.tokenAmount,
      minRaise: sale.minRaise,
      maxRaise: sale.maxRaise,
      saleStart: sale.saleStart,
      saleEnd: sale.saleEnd,
      initiator: sale.initiator,
      recipient: sale.recipient,
      refundRecipient: sale.refundRecipient,
      acceptedTokensChains: sale.acceptedTokensChains,
      acceptedTokensAddresses: sale.acceptedTokensAddresses,
      acceptedTokensConversionRates: sale.acceptedTokensConversionRates,
      solanaAcceptedTokensCount: sale.solanaAcceptedTokensCount,
      contributions: sale.contributions,
      contributionsCollected: sale.contributionsCollected,
      isSealed: sale.isSealed,
      isAborted: sale.isAborted,
    };
  }

  async collectContribution(signedVaa: Uint8Array) {
    return this.contract.collectContribution(signedVaa).then((tx) => tx.wait());
  }

  async sealSale(saleId: ethers.BigNumber) {
    // save on gas by checking the state of the sale
    const sale = await this.getSale(saleId);

    if (sale.isSealed || sale.isAborted) {
      throw Error("already sealed / aborted");
    }

    // and seal
    return this.contract.sealSale(saleId).then((tx) => tx.wait());
  }
}
