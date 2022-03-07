import { ethers } from "ethers";
import { Conductor__factory, Contributor__factory } from "..";

interface IccoSaleState {
  // sale init
  saleId: ethers.BigNumberish;
  tokenAddress: ethers.BytesLike;
  tokenChain: number;
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  recipient: ethers.BytesLike;
  refundRecipient: ethers.BytesLike;
  // accepted tokens
  acceptedTokenChains: number[];
  acceptedTokensAddresses: ethers.BytesLike[];
  acceptedTokensConversionRates: ethers.BigNumberish[];
  // state
  isSealed: boolean;
  isAborted: boolean;
}

interface IccoConductorSaleState extends IccoSaleState {
  contributions: ethers.BigNumberish[];
  contributionsCollected: boolean[];
  refundIsClaimed: boolean;
}

interface IccoContributorSaleState extends IccoSaleState {
  allocations: ethers.BigNumberish[];
}

export async function getSaleFromConductorOnEth(
  conductorAddress: string,
  provider: ethers.providers.Provider,
  saleId: ethers.BigNumberish
): Promise<IccoConductorSaleState> {
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
): Promise<IccoContributorSaleState> {
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
