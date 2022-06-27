import { ethers } from "ethers";
import {
  ChainId,
  ERC20__factory,
  IWETH__factory,
  getForeignAssetEth,
  getOriginalAssetEth,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { parseUnits } from "ethers/lib/utils";

export { tryNativeToUint8Array as nativeToUint8Array };

export async function wrapEth(wethAddress: string, amount: string, wallet: ethers.Wallet): Promise<void> {
  const weth = IWETH__factory.connect(wethAddress, wallet);
  await weth.deposit({
    value: ethers.utils.parseUnits(amount),
  });
}

export async function getCurrentBlock(provider: ethers.providers.Provider): Promise<ethers.providers.Block> {
  const currentBlockNumber = await provider.getBlockNumber();
  return provider.getBlock(currentBlockNumber);
}

export async function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getErc20Balance(
  provider: ethers.providers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<ethers.BigNumber> {
  const token = ERC20__factory.connect(tokenAddress, provider);
  return token.balanceOf(walletAddress);
}

export async function getErc20Decimals(provider: ethers.providers.Provider, tokenAddress: string): Promise<number> {
  const token = ERC20__factory.connect(tokenAddress, provider);
  return token.decimals();
}

export async function normalizeConversionRate(
  denominationDecimals: number,
  acceptedTokenDecimals: number,
  conversionRate: string
): Promise<ethers.BigNumberish> {
  const precision = 18;
  const normDecimals = denominationDecimals + precision - acceptedTokenDecimals;
  let normalizedConversionRate = parseUnits(conversionRate, normDecimals);
  return normalizedConversionRate;
}
