import { ethers } from "ethers";
import { Conductor__factory, Contributor__factory } from "..";

export async function abortSaleBeforeStartOnEth(
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  const tx = await conductor.abortSaleBeforeStartTime(saleId);
  return tx.wait();
}