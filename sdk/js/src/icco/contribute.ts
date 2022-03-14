import { ethers } from "ethers";
import { Contributor__factory, ERC20__factory } from "../ethers-contracts";
import { ChainId, hexToNativeString } from "..";

export async function contributeOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  amount: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const saleInit = await contributor.sales(saleId);
  if (!saleInit.saleID.eq(saleId)) {
    throw Error("saleInit not found on contributor");
  }

  const chainId = saleInit.acceptedTokensChains[tokenIndex] as ChainId;
  const collateralAddress = hexToNativeString(
    saleInit.acceptedTokensAddresses[tokenIndex].slice(2),
    chainId
  );
  if (
    collateralAddress === undefined ||
    collateralAddress === ethers.constants.AddressZero
  ) {
    throw Error("collateralAddress is undefined");
  }

  // approval
  {
    const token = ERC20__factory.connect(collateralAddress, wallet);
    const tx = await token.approve(contributorAddress, amount);
    const receipt = await tx.wait();
  }

  const tx = await contributor.contribute(saleId, tokenIndex, amount);
  return tx.wait();
}


export async function secureContributeOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  amount: ethers.BigNumberish,
  wallet: ethers.Wallet,
  expectedSaleTokenAddress: string
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  // confirm that the contribution is for the correct sale token
  const saleInit = await contributor.sales(saleId);
  const chainId = saleInit.acceptedTokensChains[tokenIndex] as ChainId;
  const thisSalesTokenAddress = hexToNativeString(
    saleInit.tokenAddress.slice(2),
    chainId
  );

  if (thisSalesTokenAddress?.toLowerCase() !== expectedSaleTokenAddress.toLowerCase()) {
    console.log("SHIET", thisSalesTokenAddress, expectedSaleTokenAddress)
    throw Error("wrong sale token address for provided saleID");
  }

  // now contribute
  const tx = await contributeOnEth(
      contributorAddress,
      saleId,
      tokenIndex,
      amount,
      wallet
  );
  return tx;
}