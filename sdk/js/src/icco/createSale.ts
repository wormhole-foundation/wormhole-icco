import { ethers } from "ethers";
import { Conductor__factory, ERC20__factory } from "../ethers-contracts";
import { ChainId, getForeignAssetEth } from "..";
import { nativeToUint8Array } from "./misc";
import { AcceptedToken, SaleInit, makeAcceptedToken } from "./structs";

export { AcceptedToken, SaleInit };

export async function makeAcceptedWrappedTokenEth(
  tokenBridgeAddress: string,
  provider: ethers.providers.Provider,
  originChainId: ChainId,
  originTokenAddress: string,
  foreignChainId: ChainId,
  conversion: string
): Promise<AcceptedToken> {
  if (foreignChainId === originChainId) {
    return makeAcceptedToken(originChainId, originTokenAddress, conversion);
  }

  const originAsset = nativeToUint8Array(originTokenAddress, originChainId);
  const foreignTokenAddress = await getForeignAssetEth(
    tokenBridgeAddress,
    provider,
    originChainId,
    originAsset
  );
  if (foreignTokenAddress === null) {
    throw Error("cannot find foreign asset");
  }

  return makeAcceptedToken(foreignChainId, foreignTokenAddress, conversion);
}

export async function createSaleOnEth(
  conductorAddress: string,
  tokenAddress: string,
  amount: ethers.BigNumberish,
  minRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  acceptedTokens: AcceptedToken[],
  recipientAddress: string,
  refundRecipientAddress: string,
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  // approve first
  {
    const token = ERC20__factory.connect(tokenAddress, wallet);
    const tx = await token.approve(conductorAddress, amount);
    const receipt = await tx.wait();
  }

  // now create
  const conductor = Conductor__factory.connect(conductorAddress, wallet);
  const tx = await conductor.createSale(
    tokenAddress,
    amount,
    minRaise,
    saleStart,
    saleEnd,
    acceptedTokens,
    recipientAddress,
    refundRecipientAddress
  );

  return tx.wait();
}
