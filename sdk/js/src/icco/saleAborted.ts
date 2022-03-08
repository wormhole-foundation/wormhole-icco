import { ethers } from "ethers";
import { Contributor__factory } from "../ethers-contracts";
import { getSaleFromContributorOnEth } from "./getters";
import { getSaleIdFromVaa } from "./signedVaa";

export async function saleAbortedOnEth(
  contributorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const saleId = await getSaleIdFromVaa(signedVaa);

  // save on gas by checking the state of the sale
  const sale = await getSaleFromContributorOnEth(
    contributorAddress,
    wallet.provider,
    saleId
  );

  if (sale.isSealed || sale.isAborted) {
    throw Error("already sealed / aborted");
  }

  const contributor = Contributor__factory.connect(contributorAddress, wallet);
  const tx = await contributor.saleAborted(signedVaa);
  return tx.wait();
}
