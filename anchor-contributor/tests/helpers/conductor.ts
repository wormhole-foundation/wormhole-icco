import { web3 } from "@project-serum/anchor";
import { CHAIN_ID_ETH, CHAIN_ID_SOLANA, tryNativeToHexString } from "@certusone/wormhole-sdk";
import { createMint } from "@solana/spl-token";
import { BigNumber, BigNumberish } from "ethers";

import { toBigNumberHex } from "./utils";
import { CONDUCTOR_ADDRESS, CONDUCTOR_CHAIN } from "./consts";
import { signAndEncodeVaa } from "./wormhole";

// sale struct info
export const MAX_ACCEPTED_TOKENS = 8;
const NUM_BYTES_ACCEPTED_TOKEN = 33;
const NUM_BYTES_ALLOCATION = 65;

export class DummyConductor {
  saleId: number;
  wormholeSequence: number;

  saleStart: number;
  saleEnd: number;

  initSaleVaa: Buffer;

  saleTokenOnSolana: string;
  acceptedTokens: AcceptedToken[];
  allocations: Allocation[];

  constructor() {
    this.saleId = 0;
    this.wormholeSequence = 0;

    this.saleStart = 0;
    this.saleEnd = 0;

    this.acceptedTokens = [];
    this.allocations = [];
  }

  async attestSaleToken(connection: web3.Connection, payer: web3.Keypair): Promise<void> {
    const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, 9);
    this.saleTokenOnSolana = mint.toBase58();
    return;
  }

  getSaleTokenOnSolana(): web3.PublicKey {
    return new web3.PublicKey(this.saleTokenOnSolana);
  }

  async createAcceptedTokens(connection: web3.Connection, payer: web3.Keypair): Promise<AcceptedToken[]> {
    const tokenIndices = [2, 3, 5, 8, 13, 21, 34, 55];
    const allocations = [
      "10000000000",
      "10000000000",
      "20000000000",
      "30000000000",
      "50000000000",
      "80000000000",
      "130000000000",
      "210000000000",
    ];
    const excessContributions = ["1234567", "8901234", "5678901", "2345678", "3456789", "123456", "7890123", "4567890"];
    for (let i = 0; i < MAX_ACCEPTED_TOKENS; ++i) {
      // just make everything the same number of decimals (9)
      const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, 9);
      const acceptedToken = makeAcceptedToken(tokenIndices[i], mint.toBase58());
      this.acceptedTokens.push(acceptedToken);

      // make up allocations, too
      const allocation = makeAllocation(tokenIndices[i], allocations[i], excessContributions[i]);
      this.allocations.push(allocation);
      //this.allocations
    }
    return this.acceptedTokens;
  }

  getSaleId(): Buffer {
    return Buffer.from(toBigNumberHex(this.saleId, 32), "hex");
  }

  createSale(startTime: number, duration: number, associatedSaleTokenAddress: web3.PublicKey): Buffer {
    // uptick saleId for every new sale
    ++this.saleId;

    // set up sale time based on block time
    this.saleStart = startTime;
    this.saleEnd = this.saleStart + duration;

    this.initSaleVaa = signAndEncodeVaa(
      startTime,
      this.nonce,
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS).toString("hex"),
      this.wormholeSequence,
      encodeSaleInit(
        this.saleId,
        tryNativeToHexString(associatedSaleTokenAddress.toString(), CHAIN_ID_SOLANA),
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

  sealSale(blockTime: number): Buffer {
    return signAndEncodeVaa(
      blockTime,
      this.nonce,
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS).toString("hex"),
      this.wormholeSequence,
      encodeSaleSealed(this.saleId, this.allocations)
    );
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
  recipient = tryNativeToHexString("0x22d491bde2303f2f43325b2108d26f1eaba1e32b", CHAIN_ID_ETH);

  // wormhole nonce
  nonce = 0;
}

function makeAcceptedToken(index: number, pubkey: string): AcceptedToken {
  return { index, address: tryNativeToHexString(pubkey, CHAIN_ID_SOLANA) };
}

function makeAllocation(index: number, allocation: string, excessContribution: string): Allocation {
  return { index, allocation, excessContribution };
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
  index: number;
  allocation: string; // big number, uint256
  excessContribution: string; // big number, uint256
}

export function encodeAllocations(allocations: Allocation[]): Buffer {
  const n = allocations.length;
  const encoded = Buffer.alloc(NUM_BYTES_ALLOCATION * n);
  for (let i = 0; i < n; ++i) {
    const item = allocations[i];
    const start = i * NUM_BYTES_ALLOCATION;
    encoded.writeUint8(item.index, start);
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
  encoded.writeUint8(numAllocations, headerLen);
  encoded.write(encodeAllocations(allocations).toString("hex"), headerLen + 1, "hex");

  return encoded;
}

export function encodeSaleAborted(saleId: number): Buffer {
  const encoded = Buffer.alloc(33);
  encoded.writeUInt8(4, 0); // saleSealed payload = 4
  encoded.write(toBigNumberHex(saleId, 32), 1, "hex");
  return encoded;
}
