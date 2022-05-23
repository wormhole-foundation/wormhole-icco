import { web3 } from "@project-serum/anchor";
import { BigNumber, BigNumberish } from "ethers";

export function toBigNumberHex(value: BigNumberish, numBytes: number): string {
  return BigNumber.from(value)
    .toHexString()
    .substring(2)
    .padStart(numBytes * 2, "0");
}

export async function wait(timeInSeconds: number): Promise<void> {
  await new Promise((r) => setTimeout(r, timeInSeconds * 1000));
}

export async function getBlockTime(connection: web3.Connection): Promise<number> {
  const slot = await connection.getSlot();
  return connection.getBlockTime(slot);
}
