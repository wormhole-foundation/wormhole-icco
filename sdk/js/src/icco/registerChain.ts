import { ethers } from "ethers";

import { Conductor__factory } from "../ethers-contracts";

export async function registerChainOnEth(
  conductorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Conductor__factory.connect(conductorAddress, wallet);
  const tx = await contributor.registerChain(signedVaa);
  return tx.wait();
}
