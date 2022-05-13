import { ethers } from "ethers";
import { ChainId } from "@certusone/wormhole-sdk";

import { Conductor__factory } from "../ethers-contracts";

export async function registerChainOnEth(
  conductorAddress: string,
  contributorChain: ChainId,
  contributorAddress: Uint8Array,
  contributorCustodyAddress: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Conductor__factory.connect(conductorAddress, wallet);
  const tx = await contributor.registerChain(
    contributorChain,
    contributorAddress,
    contributorCustodyAddress
  );
  return tx.wait();
}
