import { ethers } from "ethers";

import { Contributor__factory } from "../ethers-contracts";
import { getRefundIsClaimedOnEth } from "./getters";

export async function claimContributorRefundOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const isClaimed = await getRefundIsClaimedOnEth(
    contributorAddress,
    wallet.provider,
    saleId,
    tokenIndex,
    wallet.address
  );
  if (isClaimed) {
    throw Error("refund already claimed");
  }

  const tx = await contributor.claimRefund(saleId, tokenIndex);
  return tx.wait();
}
