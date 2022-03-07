import { ethers } from "ethers";
import { Contributor__factory } from "..";
import { parseIccoSaleInit } from "./createSale";
import { getSaleFromContributorOnEth } from "./getters";

export async function initSaleOnEth(
  contributorAddress: string,
  buyer: ethers.Wallet,
  signedVaa: Uint8Array
): Promise<ethers.ContractReceipt> {
  const saleInit = await parseIccoSaleInit(signedVaa);

  // check if sale exists already
  const sale = await getSaleFromContributorOnEth(
    contributorAddress,
    buyer.provider,
    saleInit.saleId
  );
  if (!ethers.BigNumber.from(sale.saleId).eq("0")) {
    throw Error("sale already exists");
  }

  const contributor = Contributor__factory.connect(contributorAddress, buyer);
  const tx = await contributor.initSale(signedVaa);
  return tx.wait();
}
