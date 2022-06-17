import { ethers } from "ethers";

import { Contributor__factory } from "../ethers-contracts";
import { getExcessContributionIsClaimedOnEth } from "./getters";

export async function claimExcessContributionOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const isClaimed = await getExcessContributionIsClaimedOnEth(
    contributorAddress,
    wallet.provider,
    saleId,
    tokenIndex,
    wallet.address
  );
  if (isClaimed) {
    throw Error("excessContribution already claimed");
  }

  const tx = await contributor.claimExcessContribution(saleId, tokenIndex);
  return tx.wait();
}
