import { ethers } from "ethers";
import { ChainId } from "..";
import { Conductor__factory, Contributor__factory } from "../ethers-contracts";
import { ConductorSale, ContributorSale } from "./structs";

export async function getSaleFromConductorOnEth(
  conductorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish
): Promise<ConductorSale> {
  const conductor = Conductor__factory.connect(conductorAddress, provider);

  const sale = await conductor.sales(saleId);

  return {
    saleId: sale.saleID,
    tokenAddress: sale.tokenAddress,
    tokenChain: sale.tokenChain,
    tokenAmount: sale.tokenAmount,
    minRaise: sale.minRaise,
    saleStart: sale.saleStart,
    saleEnd: sale.saleEnd,
    recipient: sale.recipient,
    refundRecipient: sale.refundRecipient,
    acceptedTokenChains: sale.acceptedTokensChains,
    acceptedTokensAddresses: sale.acceptedTokensAddresses,
    acceptedTokensConversionRates: sale.acceptedTokensConversionRates,
    contributions: sale.contributions,
    contributionsCollected: sale.contributionsCollected,
    isSealed: sale.isSealed,
    isAborted: sale.isAborted,
    refundIsClaimed: sale.refundIsClaimed,
  };
}

export async function getSaleFromContributorOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish
): Promise<ContributorSale> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );

  const sale = await contributor.sales(saleId);

  return {
    saleId: sale.saleID,
    tokenAddress: sale.tokenAddress,
    tokenChain: sale.tokenChain,
    tokenAmount: sale.tokenAmount,
    minRaise: sale.minRaise,
    saleStart: sale.saleStart,
    saleEnd: sale.saleEnd,
    recipient: sale.recipient,
    refundRecipient: sale.refundRecipient,
    acceptedTokenChains: sale.acceptedTokensChains,
    acceptedTokensAddresses: sale.acceptedTokensAddresses,
    acceptedTokensConversionRates: sale.acceptedTokensConversionRates,
    isSealed: sale.isSealed,
    isAborted: sale.isAborted,
    allocations: sale.allocations,
  };
}

export async function getAllocationIsClaimedOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  walletAddress: string
): Promise<boolean> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );
  return contributor.allocationIsClaimed(saleId, tokenIndex, walletAddress);
}

export async function getContributorContractOnEth(
  conductorAddress: string,
  provider: ethers.providers.Provider,
  chainId: ChainId
): Promise<string> {
  const conductor = Conductor__factory.connect(conductorAddress, provider);

  return conductor.contributorContracts(chainId);
}

export async function getContributorContractAsHexStringOnEth(
  conductorAddress: string,
  provider: ethers.providers.Provider,
  chainId: ChainId
): Promise<string> {
  const address = await getContributorContractOnEth(
    conductorAddress,
    provider,
    chainId
  );
  return address.slice(2);
}

export async function getRefundIsClaimedOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  walletAddress: string
): Promise<boolean> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );
  return contributor.refundIsClaimed(saleId, tokenIndex, walletAddress);
}

export async function getSaleTotalContributionOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number
): Promise<ethers.BigNumber> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );
  return contributor.getSaleTotalContribution(saleId, tokenIndex);
}

export async function getSaleContributionOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  walletAddress: string
): Promise<ethers.BigNumber> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );
  return contributor.getSaleContribution(saleId, tokenIndex, walletAddress);
}

export async function getSaleAllocationOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number
): Promise<ethers.BigNumber> {
  const contributor = Contributor__factory.connect(
    contributorAddress,
    provider
  );
  return contributor.getSaleAllocation(saleId, tokenIndex);
}

export async function getSaleWalletAllocationOnEth(
  contributorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  walletAddress: string
): Promise<ethers.BigNumber> {
  const [allocation, walletContribution, totalContribution] = await Promise.all(
    [
      getSaleAllocationOnEth(contributorAddress, provider, saleId, tokenIndex),
      getSaleContributionOnEth(
        contributorAddress,
        provider,
        saleId,
        tokenIndex,
        walletAddress
      ),
      getSaleTotalContributionOnEth(
        contributorAddress,
        provider,
        saleId,
        tokenIndex
      ),
    ]
  );
  return allocation.mul(walletContribution).div(totalContribution);
}
