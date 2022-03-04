import { ethers } from "ethers";
import { Contributor__factory } from "..";

export async function allocationIsClaimedOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  wallet: ethers.Wallet
): Promise<boolean> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);
  return contributor.allocationIsClaimed(saleId, tokenIndex, wallet.address);
}

export async function claimAllocationOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const isClaimed = await allocationIsClaimedOnEth(
    contributorAddress,
    saleId,
    tokenIndex,
    wallet
  );
  if (isClaimed) {
    throw Error("allocation already claimed");
  }

  const tx = await contributor.claimAllocation(saleId, tokenIndex);
  return tx.wait();
}
