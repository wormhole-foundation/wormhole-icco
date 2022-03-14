import { ethers } from "ethers";
import { Conductor__factory } from "../ethers-contracts";

export async function collectContributionOnEth(
  conductorAddress: string,
  signedVaa: Uint8Array,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  const tx = await conductor.collectContribution(signedVaa);
  return tx.wait();
}

export async function collectContributionsOnEth(
  conductorAddress: string,
  signedVaas: Uint8Array[],
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt[]> {
  const receipts: ethers.ContractReceipt[] = [];
  for (const signedVaa of signedVaas) {
    const receipt = await collectContributionOnEth(
      conductorAddress,
      signedVaa,
      wallet
    );
    receipts.push(receipt);
  }

  return receipts;
}
