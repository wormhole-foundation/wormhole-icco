import { ethers } from "ethers";
import { Conductor__factory } from "../ethers-contracts";

export async function updateSaleAuthorityOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish,
  newAuthority: string,
  signature: ethers.BytesLike,
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  // and seal
  const tx = await conductor.updateSaleAuthority(saleId, newAuthority, signature);
  return tx.wait();
}
