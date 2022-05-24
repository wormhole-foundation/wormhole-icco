import { ethers } from "ethers";
import { ChainId, uint8ArrayToHex } from "@certusone/wormhole-sdk";

import { AcceptedToken, Allocation, SaleInit, SaleSealed } from "./structs";

const VAA_PAYLOAD_NUM_ACCEPTED_TOKENS = 228;
const VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH = 50;

export async function getSaleIdFromIccoVaa(
  payload: Uint8Array
): Promise<ethers.BigNumberish> {
  return ethers.BigNumber.from(payload.slice(1, 33)).toString();
}

export async function getTargetChainIdFromTransferVaa(
  payload: Uint8Array
): Promise<ChainId> {
  return Buffer.from(payload).readUInt16BE(99) as ChainId;
}

export async function parseSaleInit(payload: Uint8Array): Promise<SaleInit> {
  const buffer = Buffer.from(payload);

  const numAcceptedTokens = buffer.readUInt8(VAA_PAYLOAD_NUM_ACCEPTED_TOKENS);
  const recipientIndex =
    VAA_PAYLOAD_NUM_ACCEPTED_TOKENS +
    numAcceptedTokens * VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH +
    1;
  return {
    payloadId: buffer.readUInt8(0),
    saleId: ethers.BigNumber.from(payload.slice(1, 33)).toString(),
    tokenAddress: uint8ArrayToHex(payload.slice(33, 65)),
    tokenChain: buffer.readUInt16BE(65),
    tokenDecimals: buffer.readUInt8(67),
    tokenAmount: ethers.BigNumber.from(payload.slice(68, 100)).toString(),
    minRaise: ethers.BigNumber.from(payload.slice(100, 132)).toString(),
    maxRaise: ethers.BigNumber.from(payload.slice(132, 164)).toString(),
    saleStart: ethers.BigNumber.from(payload.slice(164, 196)).toString(),
    saleEnd: ethers.BigNumber.from(payload.slice(196, 228)).toString(),
    acceptedTokens: parseAcceptedTokens(payload, numAcceptedTokens),
    solanaTokenAccount: uint8ArrayToHex(
      payload.slice(recipientIndex, recipientIndex + 32)
    ),
    recipient: uint8ArrayToHex(
      payload.slice(recipientIndex + 32, recipientIndex + 64)
    ),
    refundRecipient: uint8ArrayToHex(
      payload.slice(recipientIndex + 64, recipientIndex + 96)
    ),
  };
}

function parseAcceptedTokens(
  payload: Uint8Array,
  numTokens: number
): AcceptedToken[] {
  const buffer = Buffer.from(payload);

  const tokens: AcceptedToken[] = [];
  for (let i = 0; i < numTokens; ++i) {
    const startIndex =
      VAA_PAYLOAD_NUM_ACCEPTED_TOKENS +
      1 +
      i * VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH;
    const token: AcceptedToken = {
      tokenAddress: uint8ArrayToHex(payload.slice(startIndex, startIndex + 32)),
      tokenChain: buffer.readUInt16BE(startIndex + 32),
      conversionRate: ethers.BigNumber.from(
        payload.slice(
          startIndex + 34,
          startIndex + VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH
        )
      ).toString(),
    };
    tokens.push(token);
  }
  return tokens;
}

const VAA_PAYLOAD_NUM_ALLOCATIONS = 33;
const VAA_PAYLOAD_ALLOCATION_BYTES_LENGTH = 65;

export async function parseSaleSealed(
  payload: Uint8Array
): Promise<SaleSealed> {
  const buffer = Buffer.from(payload);

  const numAllocations = buffer.readUInt8(VAA_PAYLOAD_NUM_ALLOCATIONS);
  return {
    payloadId: buffer.readUInt8(0),
    saleId: ethers.BigNumber.from(payload.slice(1, 33)).toString(),
    allocations: parseAllocations(payload, numAllocations),
  };
}

function parseAllocations(
  payload: Uint8Array,
  numAllocations: number
): Allocation[] {
  const buffer = Buffer.from(payload);

  const allocations: Allocation[] = [];
  for (let i = 0; i < numAllocations; ++i) {
    const startIndex =
      VAA_PAYLOAD_NUM_ALLOCATIONS + 1 + i * VAA_PAYLOAD_ALLOCATION_BYTES_LENGTH;
    const allocation: Allocation = {
      tokenIndex: buffer.readUInt8(startIndex),
      allocation: ethers.BigNumber.from(
        payload.slice(startIndex + 1, startIndex + 33)
      ).toString(),
      excessContribution: ethers.BigNumber.from(
        payload.slice(startIndex + 33, startIndex + 65)
      ).toString(),
    };
    allocations.push(allocation);
  }
  return allocations;
}
