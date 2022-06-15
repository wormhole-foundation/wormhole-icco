import { tryNativeToHexString } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { soliditySha3 } from "web3-utils";

const elliptic = require("elliptic");

export function signContributionEth(
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  amount: ethers.BigNumberish,
  buyerAddress: string,
  totalContribution: ethers.BigNumberish,
  signer: string
): Buffer {
  const body = Buffer.alloc(6 * 32, 0);
  body.write(conductorAddress, 0, "hex");
  body.write(toBigNumberHex(saleId.toString(), 32), 32, "hex");
  body.write(toBigNumberHex(tokenIndex, 32), 2 * 32, "hex");
  body.write(toBigNumberHex(amount.toString(), 32), 3 * 32, "hex");
  body.write(tryNativeToHexString(buyerAddress, "ethereum"), 4 * 32, "hex");
  body.write(toBigNumberHex(totalContribution.toString(), 32), 5 * 32, "hex");

  const hash = soliditySha3("0x" + body.toString("hex"));
  if (hash == null) {
    throw "hash == null";
  }

  const ec = new elliptic.ec("secp256k1");
  const key = ec.keyFromPrivate(signer);
  const signature = key.sign(hash.substring(2), { canonical: true });

  const packed = Buffer.alloc(65);
  packed.write(signature.r.toString(16).padStart(64, "0"), 0, "hex");
  packed.write(signature.s.toString(16).padStart(64, "0"), 32, "hex");
  packed.writeUInt8(signature.recoveryParam, 64);
  return packed;
}

export function toBigNumberHex(value: ethers.BigNumberish, numBytes: number): string {
  return ethers.BigNumber.from(value)
    .toHexString()
    .substring(2)
    .padStart(numBytes * 2, "0");
}
