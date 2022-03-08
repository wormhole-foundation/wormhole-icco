import { ethers } from "ethers";
import { Conductor__factory } from "..";
import { getSaleFromConductorOnEth } from "./getters";
import { Allocation, SaleSealed } from "./structs";

export { Allocation, SaleSealed };

export async function sealSaleOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish
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
  const sealTx = await conductor.sealSale(saleId);
  return sealTx.wait();
}
