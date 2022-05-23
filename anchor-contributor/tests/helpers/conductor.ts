import { CHAIN_ID_ETH, CHAIN_ID_SOLANA, tryNativeToHexString } from "@certusone/wormhole-sdk";
import { BigNumber } from "ethers";
import { toBigNumberHex } from "./utils";
import { CONDUCTOR_ADDRESS, CONDUCTOR_CHAIN } from "./consts";
import { signAndEncodeVaa } from "./wormhole";
import { web3 } from "@project-serum/anchor";

// sale struct info
const NUM_BYTES_ACCEPTED_TOKEN = 33;
const NUM_BYTES_ALLOCATION = 65;

export class DummyConductor {
  saleId: number;
  wormholeSequence: number;

  saleStart: number;
  saleEnd: number;

  initSaleVaa: Buffer;

  constructor() {
    this.saleId = 0;
    this.wormholeSequence = 0;

    this.saleStart = 0;
    this.saleEnd = 0;

    this.acceptedTokens = [];
    this.acceptedTokens.push(makeAcceptedToken(2, "So11111111111111111111111111111111111111112"));
  }

  getSaleId(): Buffer {
    return Buffer.from(toBigNumberHex(this.saleId, 32), "hex");
  }

  createSale(blockTime: number, duration: number, associatedTokenAddress: web3.PublicKey): Buffer {
    // uptick saleId for every new sale
    ++this.saleId;

    // set up sale time based on block time
    this.saleStart = blockTime + 5;
    this.saleEnd = this.saleStart + duration;

    this.initSaleVaa = signAndEncodeVaa(
      blockTime,
      this.nonce,
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS).toString("hex"),
      this.wormholeSequence,
      encodeSaleInit(
        this.saleId,
        tryNativeToHexString(associatedTokenAddress.toString(), CHAIN_ID_SOLANA),
        this.tokenChain,
        this.tokenDecimals,
        this.saleStart,
        this.saleEnd,
        this.acceptedTokens,
        this.recipient
      )
    );
    return this.initSaleVaa;
  }

  abortSale(blockTime: number): Buffer {
    return signAndEncodeVaa(
      blockTime,
      this.nonce,
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS).toString("hex"),
      this.wormholeSequence,
      encodeSaleAborted(this.saleId)
    );
  }

  // sale parameters that won't change for the test
  //associatedTokenAddress = "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db";
  tokenChain = CHAIN_ID_ETH as number;
  tokenDecimals = 18;
  acceptedTokens: AcceptedToken[];
  recipient = tryNativeToHexString("0x22d491bde2303f2f43325b2108d26f1eaba1e32b", CHAIN_ID_ETH);

  // wormhole nonce
  nonce = 0;
}

function makeAcceptedToken(index: number, pubkey: string): AcceptedToken {
  return { index, address: tryNativeToHexString(pubkey, CHAIN_ID_SOLANA) };
}

export interface AcceptedToken {
  index: number; // uint8
  address: string; // 32 bytes
}

export function encodeAcceptedTokens(acceptedTokens: AcceptedToken[]): Buffer {
  const n = acceptedTokens.length;
  const encoded = Buffer.alloc(NUM_BYTES_ACCEPTED_TOKEN * n);
  for (let i = 0; i < n; ++i) {
    const token = acceptedTokens[i];
    const start = i * NUM_BYTES_ACCEPTED_TOKEN;
    encoded.writeUint8(token.index, start);
    encoded.write(token.address, start + 1, "hex");
  }
  return encoded;
}

export function encodeSaleInit(
  saleId: number,
  associatedTokenAddress: string, // 32 bytes
  tokenChain: number,
  tokenDecimals: number,
  saleStart: number,
  saleEnd: number,
  acceptedTokens: AcceptedToken[], // 33 * n_tokens
  recipient: string // 32 bytes
): Buffer {
  const numTokens = acceptedTokens.length;
  const encoded = Buffer.alloc(165 + numTokens * NUM_BYTES_ACCEPTED_TOKEN);

  encoded.writeUInt8(5, 0); // initSale payload for solana = 5
  encoded.write(toBigNumberHex(saleId, 32), 1, "hex");
  encoded.write(associatedTokenAddress, 33, "hex");
  encoded.writeUint16BE(tokenChain, 65);
  encoded.writeUint8(tokenDecimals, 67);
  encoded.write(toBigNumberHex(saleStart, 32), 68, "hex");
  encoded.write(toBigNumberHex(saleEnd, 32), 100, "hex");
  encoded.writeUInt8(numTokens, 132);
  encoded.write(encodeAcceptedTokens(acceptedTokens).toString("hex"), 133, "hex");

  const recipientIndex = 133 + numTokens * NUM_BYTES_ACCEPTED_TOKEN;
  encoded.write(recipient, recipientIndex, "hex");
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

  encoded.writeUInt8(6, 0); // saleSealed payload for solana = 6
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
