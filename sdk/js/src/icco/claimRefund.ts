import { ethers } from "ethers";
import { Conductor__factory, Contributor__factory } from "../ethers-contracts";
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

export async function claimConductorRefundOnEth(
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  const tx = await conductor.claimRefund(saleId);
  return tx.wait();
}
