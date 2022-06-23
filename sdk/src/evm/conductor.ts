import {
  ChainId,
  ChainName,
  getEmitterAddressEth,
  getForeignAssetEth,
  hexToUint8Array,
  parseSequenceFromLogEth,
} from "@certusone/wormhole-sdk";
import { GetSignedVAAResponse } from "@certusone/wormhole-sdk/lib/cjs/proto/publicrpc/v1/publicrpc";
import { ethers } from "ethers";
import { Conductor, Conductor__factory, ERC20__factory } from "../ethers-contracts";
import { AcceptedToken, Raise } from "../icco";

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

  async createSale(raise: Raise, acceptedTokens: AcceptedToken[]) {
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
