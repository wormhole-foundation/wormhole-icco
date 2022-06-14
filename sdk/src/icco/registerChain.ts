import { ethers } from "ethers";
import { ChainId } from "@certusone/wormhole-sdk";

import { Conductor__factory } from "../ethers-contracts";

export async function registerChainOnEth(
  conductorAddress: string,
  contributorChain: ChainId,
  contributorAddress: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);
  const tx = await conductor.registerChain(
    contributorChain,
    contributorAddress
  );
  return tx.wait();
}
