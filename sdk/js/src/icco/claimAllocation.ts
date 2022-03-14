import { ethers } from "ethers";
import { Contributor__factory } from "../ethers-contracts";
import { getAllocationIsClaimedOnEth } from "./getters";

export async function claimAllocationOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const isClaimed = await getAllocationIsClaimedOnEth(
    contributorAddress,
    wallet.provider,
    saleId,
    tokenIndex,
    wallet.address
  );
  if (isClaimed) {
    throw Error("allocation already claimed");
  }

  const tx = await contributor.claimAllocation(saleId, tokenIndex);
  return tx.wait();
}
