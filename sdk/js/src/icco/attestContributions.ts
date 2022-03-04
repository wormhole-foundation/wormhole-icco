import { ethers } from "ethers";
import { Contributor__factory } from "..";

export async function attestContributionsOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const tx = await contributor.attestContributions(saleId);
  return tx.wait();
}
