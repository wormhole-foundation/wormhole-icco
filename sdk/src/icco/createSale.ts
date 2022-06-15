import { ethers } from "ethers";
import { ChainId, ERC20__factory, getForeignAssetEth } from "@certusone/wormhole-sdk";
import { nativeToUint8Array } from "./misc";
import { Conductor__factory } from "../ethers-contracts";
import { AcceptedToken, SaleInit, makeAcceptedToken, Raise } from "./structs";

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
  const foreignTokenAddress = await getForeignAssetEth(tokenBridgeAddress, provider, originChainId, originAsset);
  if (foreignTokenAddress === null) {
    throw Error("cannot find foreign asset");
  }

  return makeAcceptedToken(foreignChainId, foreignTokenAddress, conversion);
}

export async function createSaleOnEth(
  conductorAddress: string,
  isFixedPrice: boolean,
  localTokenAddress: string,
  tokenAddress: string,
  tokenChain: ChainId,
  amount: ethers.BigNumberish,
  minRaise: ethers.BigNumberish,
  maxRaise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  unlockTimestamp: ethers.BigNumberish,
  acceptedTokens: AcceptedToken[],
  solanaTokenAccount: ethers.BytesLike,
  recipientAddress: string,
  refundRecipientAddress: string,
  authority: string, // kyc
  wallet: ethers.Wallet
): Promise<ethers.ContractReceipt> {
  // approve first
  {
    const token = ERC20__factory.connect(localTokenAddress, wallet);
    const tx = await token.approve(conductorAddress, amount);
    const receipt = await tx.wait();
  }

  // convert address string to bytes32
  const tokenAddressBytes32 = nativeToUint8Array(tokenAddress, tokenChain);

  // create a struct to pass to createSale
  const raise: Raise = {
    isFixedPrice: isFixedPrice,
    token: tokenAddressBytes32,
    tokenChain: tokenChain,
    tokenAmount: amount,
    minRaise: minRaise,
    maxRaise: maxRaise,
    saleStart: ethers.BigNumber.from(saleStart),
    saleEnd: ethers.BigNumber.from(saleEnd),
    unlockTimestamp: ethers.BigNumber.from(unlockTimestamp),
    recipient: recipientAddress,
    refundRecipient: refundRecipientAddress,
    solanaTokenAccount: solanaTokenAccount,
    authority: authority,
  };

  // now create
  const conductor = Conductor__factory.connect(conductorAddress, wallet);
  const tx = await conductor.createSale(raise, acceptedTokens);

  return tx.wait();
}
