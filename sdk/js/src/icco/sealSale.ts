import { ethers } from "ethers";
import { Conductor__factory } from "../ethers-contracts";
import { getSaleFromConductorOnEth } from "./getters";

export async function sealSaleOnEth(
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  // save on gas by checking the state of the sale
  const sale = await getSaleFromConductorOnEth(
    conductorAddress,
    wallet.provider,
    saleId
  );

  if (sale.isSealed || sale.isAborted) {
    throw Error("already sealed / aborted");
  }

  // and seal
  const tx = await conductor.sealSale(saleId);
  return tx.wait();
}
