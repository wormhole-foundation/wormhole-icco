import { ethers } from "ethers";
import {
  ChainId,
  ERC20__factory,
  IWETH__factory,
  hexToUint8Array,
  nativeToHexString,
  getForeignAssetEth,
  getOriginalAssetEth,
  hexToNativeString,
  uint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { parseUnits } from "ethers/lib/utils";

export function nativeToUint8Array(
  address: string,
  chainId: ChainId
): Uint8Array {
  return hexToUint8Array(nativeToHexString(address, chainId) || "");
}

export async function wrapEth(
  wethAddress: string,
  amount: string,
  wallet: ethers.Wallet
): Promise<void> {
  const weth = IWETH__factory.connect(wethAddress, wallet);
  await weth.deposit({
    value: ethers.utils.parseUnits(amount),
  });
}

export async function getCurrentBlock(
  provider: ethers.providers.Provider
): Promise<ethers.providers.Block> {
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

export async function getErc20Decimals(
  provider: ethers.providers.Provider,
  tokenAddress: string
): Promise<number> {
  const token = ERC20__factory.connect(tokenAddress, provider);
  return token.decimals();
}

export async function getAcceptedTokenDecimalsOnConductor(
  contributorChain: ChainId,
  conductorChain: ChainId,
  contributorTokenBridgeAddress: string,
  conductorTokenBridgeAddress: string,
  contributorProvider: ethers.providers.Provider,
  conductorProvider: ethers.providers.Provider,
  contributedTokenAddress: string,
  condtributedTokenDecimals: number
): Promise<number> {
  if (contributorChain !== conductorChain) {
    // fetch the original token address for contributed token
    const originalToken = await getOriginalAssetEth(
      contributorTokenBridgeAddress,
      contributorProvider,
      contributedTokenAddress,
      contributorChain
    );
    let tokenDecimalsOnConductor;
    if (originalToken.chainId === conductorChain) {
      // get the original decimals
      const nativeConductorAddress = uint8ArrayToNative(
        originalToken.assetAddress,
        originalToken.chainId
      );

      if (nativeConductorAddress !== undefined) {
        // fetch the token decimals on the conductor chain
        tokenDecimalsOnConductor = await getErc20Decimals(
          conductorProvider,
          nativeConductorAddress
        );
      } else {
        throw Error("Native conductor address is undefined");
      }
    } else {
      // get the wrapped versionals decimals on eth
      const conductorWrappedToken = await getForeignAssetEth(
        conductorTokenBridgeAddress,
        conductorProvider,
        originalToken.chainId,
        originalToken.assetAddress
      );

      if (conductorWrappedToken !== null) {
        // fetch the token decimals on the conductor chain
        tokenDecimalsOnConductor = await getErc20Decimals(
          conductorProvider,
          conductorWrappedToken
        );
      } else {
        throw Error("Wrapped conductor address is null");
      }
    }
    return tokenDecimalsOnConductor;
  } else {
    return condtributedTokenDecimals;
  }
}

export async function normalizeConversionRate(
  denominationDecimals: number,
  acceptedTokenDecimals: number,
  conversionRate: string,
  conductorDecimals: number
): Promise<ethers.BigNumberish> {
  const precision = 18;
  const normDecimals = denominationDecimals + precision - acceptedTokenDecimals;
  let normalizedConversionRate = parseUnits(conversionRate, normDecimals);

  if (acceptedTokenDecimals === conductorDecimals) {
    return normalizedConversionRate;
  } else if (acceptedTokenDecimals > conductorDecimals) {
    return normalizedConversionRate.div(
      parseUnits("1", acceptedTokenDecimals - conductorDecimals)
    );
  } else {
    return normalizedConversionRate.mul(
      parseUnits("1", conductorDecimals - acceptedTokenDecimals)
    );
  }
}
