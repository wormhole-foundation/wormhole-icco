import { ethers } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import {
  ChainId,
  IWETH__factory,
  hexToNativeString,
  hexToUint8Array,
  importCoreWasm,
  nativeToHexString,
  uint8ArrayToHex,
} from "..";

export function nativeToUint8Array(
  address: string,
  chainId: ChainId
): Uint8Array {
  return hexToUint8Array(nativeToHexString(address, chainId) || "");
}

export async function wrapEth(
  signer: ethers.Wallet,
  wethAddress: string,
  amount: string
): Promise<void> {
  const weth = IWETH__factory.connect(wethAddress, signer);
  await weth.deposit({
    value: parseUnits(amount),
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

export async function extractVaaPayload(
  signedVaa: Uint8Array
): Promise<Uint8Array> {
  const { parse_vaa } = await importCoreWasm();
  const { payload: payload } = parse_vaa(signedVaa);
  return payload;
}
