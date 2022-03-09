import { ethers } from "ethers";
import { Conductor__factory } from "../ethers-contracts";

export async function collectContributionOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  signedVaa: Uint8Array
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  const tx = await conductor.collectContribution(signedVaa);
  return tx.wait();
}

export async function collectContributionsOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  signedVaas: Uint8Array[]
): Promise<ethers.ContractReceipt[]> {
  const receipts: ethers.ContractReceipt[] = [];
  for (const signedVaa of signedVaas) {
    const receipt = await collectContributionOnEth(
      conductorAddress,
      wallet,
      signedVaa
    );
    receipts.push(receipt);
  }

  return receipts;
}
