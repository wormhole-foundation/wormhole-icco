import { ethers } from "ethers";
import { Contributor__factory, ERC20__factory } from "../ethers-contracts";
import {
  ChainId,
  getSaleFromContributorOnEth,
  hexToNativeString,
  nativeToHexString,
} from "..";

export async function contributeOnEth(
  contributorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  amount: ethers.BigNumberish,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  const contributor = Contributor__factory.connect(contributorAddress, wallet);

  const sale = await getSaleFromContributorOnEth(
    contributorAddress,
    wallet.provider,
    saleId
  );
  if (!ethers.BigNumber.from(sale.saleId).eq(saleId)) {
    throw Error("saleInit not found on contributor");
  }

  const chainId = sale.acceptedTokensChains[tokenIndex] as ChainId;
  const collateralAddress = hexToNativeString(
    ethers.utils.hexlify(sale.acceptedTokensAddresses[tokenIndex]).slice(2),
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
  saleTokenAddress: string,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  // confirm that the contribution is for the correct sale token
  const sale = await getSaleFromContributorOnEth(
    contributorAddress,
    wallet.provider,
    saleId
  );

  const actual = ethers.utils.hexlify(sale.tokenAddress).slice(2);
  const expected = nativeToHexString(
    saleTokenAddress,
    sale.tokenChain as ChainId
  );
  if (expected === null) {
    throw Error("cannot convert expecteSaleTokenAddress to hex string");
  }

  if (expected !== actual) {
    throw Error("wrong sale token address for provided saleId");
  }

  // now contribute
  return contributeOnEth(
    contributorAddress,
    saleId,
    tokenIndex,
    amount,
    wallet
  );
}
