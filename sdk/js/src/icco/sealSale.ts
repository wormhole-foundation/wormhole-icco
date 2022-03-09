import { ethers } from "ethers";
import { ConductorSale, getTargetChainIdFromTransferVaa } from ".";
import {
  ChainId,
  Conductor__factory,
  getEmitterAddressEth,
  getSignedVAA,
  getSignedVAAWithRetry,
  parseSequencesFromLogEth,
} from "..";
import { getSaleFromConductorOnEth } from "./getters";

export async function sealSaleOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish
): Promise<ethers.ContractReceipt> {
  const conductor = Conductor__factory.connect(conductorAddress, wallet);

  // save on gas by checking the state of the sale
  const sale = await getSaleFromConductorOnEth(
    conductorAddress,
    wallet.provider,
    saleId
  );

  if (sale.isSealed || sale.isAborted) {
    throw Error("already sealed / aborted");
  }

  // and seal
  const tx = await conductor.sealSale(saleId);
  return tx.wait();
}

export interface SealSaleResult {
  sale: ConductorSale;
  transferVaas: Map<ChainId, Uint8Array[]>;
  sealSaleVaa: Uint8Array;
}

export async function sealSaleAndParseReceiptOnEth(
  conductorAddress: string,
  wallet: ethers.Wallet,
  saleId: ethers.BigNumberish,
  coreBridgeAddress: string,
  tokenBridgeAddress: string,
  wormholeHosts: string[],
  extraGrpcOpts: any = {}
): Promise<SealSaleResult> {
  const receipt = await sealSaleOnEth(conductorAddress, wallet, saleId);

  const sale = await getSaleFromConductorOnEth(
    conductorAddress,
    wallet.provider,
    saleId
  );
  const emitterChain = sale.tokenChain as ChainId;

  const sequences = parseSequencesFromLogEth(receipt, coreBridgeAddress);
  const sealSaleSequence = sequences.pop();
  if (sealSaleSequence === undefined) {
    throw Error("no vaa sequences found");
  }

  const result = await getSignedVAAWithRetry(
    wormholeHosts,
    emitterChain,
    getEmitterAddressEth(conductorAddress),
    sealSaleSequence,
    extraGrpcOpts
  );
  const sealSaleVaa = result.vaaBytes;

  // doing it serially for ease of putting into the map
  const mapped = new Map<ChainId, Uint8Array[]>();
  for (const sequence of sequences) {
    const result = await getSignedVAAWithRetry(
      wormholeHosts,
      emitterChain,
      getEmitterAddressEth(tokenBridgeAddress),
      sequence,
      extraGrpcOpts
    );
    const signedVaa = result.vaaBytes;
    const chainId = await getTargetChainIdFromTransferVaa(signedVaa);

    const signedVaas = mapped.get(chainId);
    if (signedVaas === undefined) {
      mapped.set(chainId, [signedVaa]);
    } else {
      signedVaas.push(signedVaa);
    }
  }

  return {
    sale: sale,
    transferVaas: mapped,
    sealSaleVaa: sealSaleVaa,
  };
}
