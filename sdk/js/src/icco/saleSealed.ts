import { ethers } from "ethers";
import { Contributor__factory } from "..";

export async function saleSealedOnEth(
  contributorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);
  const tx = await contributor.saleSealed(signedVaa);
  return tx.wait();
}
