import { ethers } from "ethers";
import { AcceptedToken, Allocation, SaleInit, SaleSealed } from "./structs";
import { ChainId, importCoreWasm, uint8ArrayToHex } from "..";

const VAA_PAYLOAD_NUM_ACCEPTED_TOKENS = 195;
const VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH = 66;

export async function extractVaaPayload(
  signedVaa: Uint8Array
): Promise<Uint8Array> {
  const { parse_vaa } = await importCoreWasm();
  const { payload: payload } = parse_vaa(signedVaa);
  return payload;
}

export async function getSaleIdFromSaleVaa(
  signedVaa: Uint8Array
): Promise<ethers.BigNumberish> {
  const payload = await extractVaaPayload(signedVaa);
  return ethers.BigNumber.from(payload.slice(1, 33)).toString();
}

export async function getTargetChainIdFromTransferVaa(
  signedVaa: Uint8Array
): Promise<ChainId> {
  const payload = await extractVaaPayload(signedVaa);
  return Buffer.from(payload).readUInt16BE(99) as ChainId;
}

export async function parseSaleInit(signedVaa: Uint8Array): Promise<SaleInit> {
  const payload = await extractVaaPayload(signedVaa);

  const buffer = Buffer.from(payload);

  const numAcceptedTokens = buffer.readUInt8(VAA_PAYLOAD_NUM_ACCEPTED_TOKENS);
  const recipientIndex =
    VAA_PAYLOAD_NUM_ACCEPTED_TOKENS + numAcceptedTokens * 66 + 1;
  return {
    payloadId: buffer.readUInt8(0),
    saleId: ethers.BigNumber.from(payload.slice(1, 33)).toString(),
    tokenAddress: uint8ArrayToHex(payload.slice(33, 65)),
    tokenChain: buffer.readUInt16BE(65),
    tokenAmount: ethers.BigNumber.from(payload.slice(67, 99)).toString(),
    minRaise: ethers.BigNumber.from(payload.slice(99, 131)).toString(),
    saleStart: ethers.BigNumber.from(payload.slice(131, 163)).toString(),
    saleEnd: ethers.BigNumber.from(payload.slice(163, 195)).toString(),
    acceptedTokens: parseAcceptedTokens(payload, numAcceptedTokens),
    recipient: uint8ArrayToHex(
      payload.slice(recipientIndex, recipientIndex + 32)
    ),
    refundRecipient: uint8ArrayToHex(
      payload.slice(recipientIndex + 32, recipientIndex + 64)
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
        payload.slice(startIndex + 34, startIndex + 66)
      ).toString(),
    };
    tokens.push(token);
  }
  return tokens;
}

const VAA_PAYLOAD_NUM_ALLOCATIONS = 33;
const VAA_PAYLOAD_ALLOCATION_BYTES_LENGTH = 33;

export async function parseSaleSealed(
  signedVaa: Uint8Array
): Promise<SaleSealed> {
  const payload = await extractVaaPayload(signedVaa);

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
    };
    allocations.push(allocation);
  }
  return allocations;
}
