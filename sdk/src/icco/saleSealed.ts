import { ethers } from "ethers";

import { Contributor__factory } from "../ethers-contracts";
import { getSaleFromContributorOnEth } from "./getters";

export async function saleSealedOnEth(
  contributorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish
): Promise<ethers.ContractReceipt> {
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
  const tx = await contributor.saleSealed(signedVaa);
  return tx.wait();
}
