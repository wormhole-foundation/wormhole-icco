import { importCoreWasm } from "@certusone/wormhole-sdk";
import { BN, Program, web3 } from "@project-serum/anchor";
import { AnchorContributor } from "../../target/types/anchor_contributor";

import { findBuyerAccount, findSaleAccount, findSignedVaaAccount, KeyBump } from "./accounts";
import { getBuyerState, getSaleState } from "./fetch";
import { postVaa } from "./wormhole";

export class IccoContributor {
  program: Program<AnchorContributor>;
  tokenCustodianAccount: KeyBump;

  constructor(program: Program<AnchorContributor>) {
    this.program = program;
  }

  async initSale(payer: web3.Keypair, initSaleVaa: Buffer): Promise<string> {
    const program = this.program;

    // first post signed vaa to wormhole
    await postVaa(program.provider.connection, payer, initSaleVaa);
    const signedVaaAccount = findSignedVaaAccount(initSaleVaa);

    const saleId = await parseSaleId(initSaleVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);

    //const contributorAccount = this.contributorAccount;
    return program.methods
      .initSale()
      .accounts({
        sale: saleAccount.key,
        coreBridgeVaa: signedVaaAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async contribute(payer: web3.Keypair, saleId: Buffer, tokenIndex: number, amount: BN): Promise<string> {
    const program = this.program;

    const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
    const saleAccount = findSaleAccount(program.programId, saleId);

    return program.methods
      .contribute(tokenIndex, amount)
      .accounts({
        sale: saleAccount.key,
        buyer: buyerAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async sealSale(payer: web3.Keypair, saleSealedVaa: Buffer): Promise<string> {
    const program = this.program;

    // first post signed vaa to wormhole
    await postVaa(program.provider.connection, payer, saleSealedVaa);
    const signedVaaAccount = findSignedVaaAccount(saleSealedVaa);

    const saleId = await parseSaleId(saleSealedVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);

    return program.methods
      .sealSale()
      .accounts({
        sale: saleAccount.key,
        coreBridgeVaa: signedVaaAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async abortSale(payer: web3.Keypair, saleAbortedVaa: Buffer): Promise<string> {
    const program = this.program;

    // first post signed vaa to wormhole
    await postVaa(program.provider.connection, payer, saleAbortedVaa);
    const signedVaaAccount = findSignedVaaAccount(saleAbortedVaa);

    const saleId = await parseSaleId(saleAbortedVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);

    return program.methods
      .abortSale()
      .accounts({
        sale: saleAccount.key,
        coreBridgeVaa: signedVaaAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async getSale(saleId: Buffer) {
    const program = this.program;
    const saleAccount = findSaleAccount(program.programId, saleId);
    return getSaleState(program, saleAccount);
  }

  async getBuyer(saleId: Buffer, buyer: web3.PublicKey) {
    const program = this.program;
    const buyerAccount = findBuyerAccount(program.programId, saleId, buyer);
    return getBuyerState(program, buyerAccount);
  }
}

async function parseSaleId(iccoVaa: Buffer): Promise<Buffer> {
  const { parse_vaa } = await importCoreWasm();
  return Buffer.from(parse_vaa(iccoVaa).payload).subarray(1, 33);
}
