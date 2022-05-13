import { Int, LCDClient, LocalTerra, Wallet } from "@terra-money/terra.js";
import { BigNumber, BigNumberish } from "ethers";
import { soliditySha3 } from "web3-utils";
import { queryContract } from "../helpers";

const elliptic = require("elliptic");

// sale struct info
const NUM_BYTES_ACCEPTED_TOKEN = 50;
const NUM_BYTES_ALLOCATION = 65;

// conductor info
export const CONDUCTOR_CHAIN = 2;
export const CONDUCTOR_ADDRESS = "000000000000000000000000f19a2a01b70519f67adb309a994ec8c69a967e8b";

export interface Actors {
  owner: Wallet;
  seller: Wallet;
  buyers: Wallet[];
}

export function makeClientAndWallets(): [LCDClient, Actors] {
  const terra = new LocalTerra();
  const wallets = terra.wallets;
  return [
    terra,
    {
      owner: wallets.test1,
      seller: wallets.test2,
      buyers: [wallets.test3, wallets.test4],
    },
  ];
}

export function signAndEncodeConductorVaa(
  timestamp: number,
  nonce: number,
  sequence: number,
  data: Buffer
): Buffer {
  return signAndEncodeVaaBeta(
    //return signAndEncodeVaaLegacy(
    timestamp,
    nonce,
    CONDUCTOR_CHAIN,
    CONDUCTOR_ADDRESS,
    sequence,
    data
  );
}

export function signAndEncodeVaaBeta(
  timestamp: number,
  nonce: number,
  emitterChainId: number,
  emitterAddress: string,
  sequence: number,
  data: Buffer
): Buffer {
  if (Buffer.from(emitterAddress, "hex").length != 32) {
    throw Error("emitterAddress != 32 bytes");
  }

  // wormhole initialized with only one guardian in devnet
  const signers = ["cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0"];

  const sigStart = 6;
  const numSigners = signers.length;
  const sigLength = 66;
  const bodyStart = sigStart + sigLength * numSigners;
  const bodyHeaderLength = 51;
  const vm = Buffer.alloc(bodyStart + bodyHeaderLength + data.length);

  // header
  const guardianSetIndex = 0;

  vm.writeUInt8(1, 0);
  vm.writeUInt32BE(guardianSetIndex, 1);
  vm.writeUInt8(numSigners, 5);

  // encode body with arbitrary consistency level
  const consistencyLevel = 1;

  vm.writeUInt32BE(timestamp, bodyStart);
  vm.writeUInt32BE(nonce, bodyStart + 4);
  vm.writeUInt16BE(emitterChainId, bodyStart + 8);
  vm.write(emitterAddress, bodyStart + 10, "hex");
  vm.writeBigUInt64BE(BigInt(sequence), bodyStart + 42);
  vm.writeUInt8(consistencyLevel, bodyStart + 50);
  vm.write(data.toString("hex"), bodyStart + bodyHeaderLength, "hex");

  // signatures
  const body = vm.subarray(bodyStart).toString("hex");
  const hash = soliditySha3(soliditySha3("0x" + body)!)!.substring(2);

  for (let i = 0; i < numSigners; ++i) {
    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPrivate(signers[i]);
    const signature = key.sign(hash, { canonical: true });

    const start = sigStart + i * sigLength;
    vm.writeUInt8(i, start);
    vm.write(signature.r.toString(16).padStart(64, "0"), start + 1, "hex");
    vm.write(signature.s.toString(16).padStart(64, "0"), start + 33, "hex");
    vm.writeUInt8(signature.recoveryParam, start + 65);
    //console.log("  beta signature", vm.subarray(start, start + 66).toString("hex"));
  }

  return vm;
}

export interface AcceptedToken {
  address: string; // 32 bytes
  chain: number; // uint16
  conversionRate: string; // uint128
}

export function encodeAcceptedTokens(acceptedTokens: AcceptedToken[]): Buffer {
  const n = acceptedTokens.length;
  const encoded = Buffer.alloc(NUM_BYTES_ACCEPTED_TOKEN * n);
  for (let i = 0; i < n; ++i) {
    const token = acceptedTokens[i];
    const start = i * NUM_BYTES_ACCEPTED_TOKEN;
    encoded.write(token.address, start, "hex");
    encoded.writeUint16BE(token.chain, start + 32);
    encoded.write(toBigNumberHex(token.conversionRate, 16), start + 34, "hex");
  }
  return encoded;
}

export function encodeSaleInit(
  saleId: number,
  tokenAddress: string, // 32 bytes
  tokenChain: number,
  tokenAmount: string, // uint256
  minRaise: string, // uint256
  maxRaise: string, // uint256
  saleStart: number,
  saleEnd: number,
  acceptedTokens: AcceptedToken[], // 50 * n_tokens
  recipient: string, // 32 bytes
  refundRecipient: string // 32 bytes
): Buffer {
  const numTokens = acceptedTokens.length;
  const encoded = Buffer.alloc(292 + numTokens * NUM_BYTES_ACCEPTED_TOKEN);

  encoded.writeUInt8(1, 0); // initSale payload = 1
  encoded.write(toBigNumberHex(saleId, 32), 1, "hex");
  encoded.write(tokenAddress, 33, "hex");
  encoded.writeUint16BE(tokenChain, 65);
  encoded.write(toBigNumberHex(tokenAmount, 32), 67, "hex");
  encoded.write(toBigNumberHex(minRaise, 32), 99, "hex");
  encoded.write(toBigNumberHex(maxRaise, 32), 131, "hex");
  encoded.write(toBigNumberHex(saleStart, 32), 163, "hex");
  encoded.write(toBigNumberHex(saleEnd, 32), 195, "hex");
  encoded.writeUInt8(numTokens, 227);
  encoded.write(encodeAcceptedTokens(acceptedTokens).toString("hex"), 228, "hex");

  const recipientIndex = 228 + numTokens * NUM_BYTES_ACCEPTED_TOKEN;
  encoded.write(recipient, recipientIndex, "hex");
  encoded.write(refundRecipient, recipientIndex + 32, "hex");
  return encoded;
}

export interface Allocation {
  allocation: BigNumber; // uint256
  excessContribution: BigNumber; // uint256
}

export function encodeAllocations(allocations: Allocation[]): Buffer {
  const n = allocations.length;
  const encoded = Buffer.alloc(NUM_BYTES_ALLOCATION * n);
  for (let i = 0; i < n; ++i) {
    const item = allocations[i];
    const start = i * NUM_BYTES_ALLOCATION;
    encoded.writeUint8(i, start);
    encoded.write(toBigNumberHex(item.allocation, 32), start + 1, "hex");
    encoded.write(toBigNumberHex(item.excessContribution, 32), start + 33, "hex");
  }
  return encoded;
}

export function encodeSaleSealed(
  saleId: number,
  allocations: Allocation[] // 65 * n_allocations
): Buffer {
  const headerLen = 33;
  const numAllocations = allocations.length;
  const encoded = Buffer.alloc(headerLen + numAllocations * NUM_BYTES_ALLOCATION);

  encoded.writeUInt8(3, 0); // saleSealed payload = 3
  encoded.write(toBigNumberHex(saleId, 32), 1, "hex");
  encoded.write(encodeAllocations(allocations).toString("hex"), headerLen, "hex");

  return encoded;
}

export function encodeSaleAborted(saleId: number): Buffer {
  const encoded = Buffer.alloc(33);
  encoded.writeUInt8(4, 0); // saleSealed payload = 4
  encoded.write(toBigNumberHex(saleId, 32), 1, "hex");
  return encoded;
}

function toBigNumberHex(value: BigNumberish, numBytes: number): string {
  return BigNumber.from(value)
    .toHexString()
    .substring(2)
    .padStart(numBytes * 2, "0");
}

// misc
export async function getBlockTime(terra: LCDClient): Promise<number> {
  const info = await terra.tendermint.blockInfo();
  const time = new Date(info.block.header.time);
  return Math.floor(time.getTime() / 1000);
}

export function getErrorMessage(error: any): string {
  return error.response.data.message;
}

// contract queries
export async function getBalance(terra: LCDClient, asset: string, account: string): Promise<Int> {
  if (asset.startsWith("u")) {
    const [balance] = await terra.bank.balance(account);
    const coin = balance.get(asset);
    if (coin !== undefined) {
      return new Int(coin.amount);
    }
    return new Int(0);
  }

  const msg: any = {
    balance: {
      address: account,
    },
  };
  const result = await queryContract(terra, asset, msg);
  return new Int(result.balance);
}

export async function getBuyerStatus(
  terra: LCDClient,
  contributor: string,
  saleId: Buffer,
  tokenIndex: number,
  buyer: string
): Promise<any> {
  const msg: any = {
    buyer_status: {
      sale_id: saleId.toString("base64"),
      token_index: tokenIndex,
      buyer,
    },
  };
  const result = await queryContract(terra, contributor, msg);

  // verify header
  for (let i = 0; i < 32; ++i) {
    if (result.id[i] != saleId[i]) {
      throw Error("id != expected");
    }
  }
  if (result.token_index != tokenIndex) {
    throw Error("token_index != expected");
  }
  if (result.buyer != buyer) {
    throw Error("buyer != expected");
  }
  return result.status;
}

export async function getTotalContribution(
  terra: LCDClient,
  contributor: string,
  saleId: Buffer,
  tokenIndex: number
): Promise<Int> {
  const msg: any = {
    total_contribution: {
      sale_id: saleId.toString("base64"),
      token_index: tokenIndex,
    },
  };
  const result = await queryContract(terra, contributor, msg);

  // verify header
  for (let i = 0; i < 32; ++i) {
    if (result.id[i] != saleId[i]) {
      throw Error("id != expected");
    }
  }
  if (result.token_index != tokenIndex) {
    throw Error("token_index != expected");
  }
  return new Int(result.amount);
}
