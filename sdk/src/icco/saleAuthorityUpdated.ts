import { ethers } from "ethers";

import { Contributor__factory } from "../ethers-contracts";

export async function saleAuthorityUpdatedOnEth(
  contributorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);
  const tx = await contributor.saleAuthorityUpdated(signedVaa);
  return tx.wait();
}