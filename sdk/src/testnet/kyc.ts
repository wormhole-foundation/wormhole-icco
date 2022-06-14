import { ethers } from "ethers";
import Web3 from "web3";
const elliptic = require("elliptic");

export async function signContribution(
  rpc: string,
  conductorAddress: string,
  saleId: ethers.BigNumberish,
  tokenIndex: number,
  amount: ethers.BigNumberish,
  buyerAddress: string,
  totalContribution: ethers.BigNumberish,
  signer: string
): Promise<ethers.BytesLike> {
  const web3 = new Web3(rpc);

  const body = [
    web3.eth.abi
      .encodeParameter("bytes32", "0x" + conductorAddress)
      .substring(2),
    web3.eth.abi.encodeParameter("uint256", saleId).substring(2),
    web3.eth.abi.encodeParameter("uint256", tokenIndex).substring(2),
    web3.eth.abi.encodeParameter("uint256", amount).substring(2),
    web3.eth.abi
      .encodeParameter("address", buyerAddress)
      .substring(2), // we actually want 32 bytes
    web3.eth.abi.encodeParameter("uint256", totalContribution).substring(2),
  ];

  // compute the hash
  const msg = Buffer.from("0x" + body.join(""));
  const hash = web3.utils.soliditySha3(msg.toString());

  const ec = new elliptic.ec("secp256k1");
  const key = ec.keyFromPrivate(signer.substring(2));
  const signature = key.sign(hash?.substring(2), { canonical: true });

  const packSig = [
    zeroPadBytes(signature.r.toString(16), 32),
    zeroPadBytes(signature.s.toString(16), 32),
    web3.eth.abi
      .encodeParameter("uint8", signature.recoveryParam)
      .substr(2 + (64 - 2)),
  ];

  return "0x" + packSig.join("");
}

function zeroPadBytes(value: string, length: number) {
  while (value.length < 2 * length) {
    value = "0" + value;
  }
  return value;
}
