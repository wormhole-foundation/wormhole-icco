import { ethers } from "ethers";
import {
  ChainId,
  Conductor__factory,
  Contributor__factory,
  ERC20,
  getForeignAssetEth,
  uint8ArrayToHex,
} from "..";
import { extractVaaPayload, nativeToUint8Array } from "./misc";

const VAA_PAYLOAD_NUM_ACCEPTED_TOKENS = 195;
const VAA_PAYLOAD_ACCEPTED_TOKEN_BYTES_LENGTH = 66;

export interface AcceptedToken {
  tokenAddress: ethers.BytesLike;
  tokenChain: ethers.BigNumberish;
  conversionRate: ethers.BigNumberish;
}

export function makeAcceptedToken(
  chainId: ChainId,
  address: string,
  conversion: string
): AcceptedToken {
  return {
    tokenChain: chainId,
    tokenAddress: nativeToUint8Array(address, chainId),
    conversionRate: ethers.utils.parseUnits(conversion), // always 1e18
  };
}

export async function makeAcceptedWrappedTokenEth(
  tokenBridgeAddress: string,
  provider: ethers.providers.Provider,
  originChainId: ChainId,
  originTokenAddress: string,
  foreignChainId: ChainId,
  conversion: string
): Promise<AcceptedToken> {
  if (foreignChainId === originChainId) {
    return makeAcceptedToken(originChainId, originTokenAddress, conversion);
  }

  const originAsset = nativeToUint8Array(originTokenAddress, originChainId);
  const foreignTokenAddress = await getForeignAssetEth(
    tokenBridgeAddress,
    provider,
    originChainId,
    originAsset
  );
  if (foreignTokenAddress === null) {
    throw Error("cannot find foreign asset");
  }

  return makeAcceptedToken(foreignChainId, foreignTokenAddress, conversion);
}

export async function createSaleOnEth(
  conductorAddress: string,
  seller: ethers.Wallet,
  token: ERC20,
  amount: ethers.BigNumberish,
  raise: ethers.BigNumberish,
  saleStart: ethers.BigNumberish,
  saleEnd: ethers.BigNumberish,
  acceptedTokens: AcceptedToken[]
): Promise<ethers.ContractReceipt> {
  // approve first
  {
    const tx = await token.approve(conductorAddress, amount);
    const receipt = await tx.wait();
  }

  // now create
  const conductor = Conductor__factory.connect(conductorAddress, seller);
  const tx = await conductor.createSale(
    token.address,
    amount,
    raise,
    saleStart,
    saleEnd,
    acceptedTokens,
    seller.address,
    seller.address
  );

  return tx.wait();
}

export interface IccoSaleInit {
  payloadId: number;
  saleId: ethers.BigNumberish;
  tokenAddress: string;
  tokenChain: number;
  tokenAmount: ethers.BigNumberish;
  minRaise: ethers.BigNumberish;
  saleStart: ethers.BigNumberish;
  saleEnd: ethers.BigNumberish;
  acceptedTokens: AcceptedToken[];
  recipient: string;
  refundRecipient: string;
}

export async function parseIccoSaleInit(
  signedVaa: Uint8Array
): Promise<IccoSaleInit> {
  //const { parse_vaa } = await importCoreWasm();
  //const { payload: payload } = parse_vaa(signedVaa);
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
