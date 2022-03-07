import { ethers } from "ethers";
import { Contributor__factory } from "..";

export async function saleSealedOnEth(
  contributorAddress: string,
  signedVaa: Uint8Array,
  signer: ethers.Signer
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, signer);
  const tx = await contributor.saleSealed(signedVaa);
  return tx.wait();
}
