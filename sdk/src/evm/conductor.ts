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
import { AcceptedToken, Raise } from "../icco";
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
            true, // allowOwnerOffCurve
            "confirmed"
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
      const tx = await token.approve(this.address(), raise.tokenAmount);
      const receipt = await tx.wait();
    }

    // now create
    const tx = await contract.createSale(raise, acceptedTokens);
    return tx.wait();
  }
}
