import { ethers } from "ethers";
import { Conductor__factory } from "..";

export async function collectContributionOnEth(
  conductorAddress: string,
  signer: ethers.Signer,
  signedVaa: Uint8Array
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, signer);

  const tx = await conductor.collectContribution(signedVaa);
  return tx.wait();
}

export async function collectContributionsOnEth(
  conductorAddress: string,
  signer: ethers.Signer,
  signedVaas: Uint8Array[]
): Promise<ethers.ContractReceipt[]> {
  const receipts: ethers.ContractReceipt[] = [];
  for (const signedVaa of signedVaas) {
    const receipt = await collectContributionOnEth(
      conductorAddress,
      signer,
      signedVaa
    );
    receipts.push(receipt);
  }

  return receipts;
}
