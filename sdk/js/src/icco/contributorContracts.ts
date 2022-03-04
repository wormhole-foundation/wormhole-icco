import { ethers } from "ethers";
import { ChainId, Conductor__factory } from "..";

export async function checkRegisteredContributor(
  provider: ethers.providers.Provider,
  chainId: ChainId,
  conductorAddress: string
): Promise<string> {
  const conductor = Conductor__factory.connect(conductorAddress, provider);

  return conductor.contributorContracts(chainId);
}
