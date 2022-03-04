import { ethers } from "ethers";
import { Conductor__factory } from "..";
import { extractVaaPayload } from "./misc";

const VAA_PAYLOAD_NUM_ALLOCATIONS = 33;
const VAA_PAYLOAD_ALLOCATION_BYTES_LENGTH = 33;

export interface Allocation {
  tokenIndex: number;
  allocation: ethers.BigNumberish;
}

export interface IccoSaleSealed {
  payloadId: number;
  saleId: ethers.BigNumberish;
  allocations: Allocation[];
}

export async function parseIccoSaleSealed(
  signedVaa: Uint8Array
): Promise<IccoSaleSealed> {
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

export async function sealSaleOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  // need to calculate allocations in order to calculate proper approvals
  const sale = await conductor.sales(saleId);

  if (sale.isSealed || sale.isAborted) {
    throw Error("already sealed / aborted");
  }

  // and seal
  const sealTx = await conductor.sealSale(saleId);
  return sealTx.wait();
}
