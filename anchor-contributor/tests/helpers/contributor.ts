import { importCoreWasm } from "@certusone/wormhole-sdk";
import { BN, Program, web3 } from "@project-serum/anchor";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import { getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { findBuyerAccount, findCustodianAccount, findSaleAccount, findSignedVaaAccount, KeyBump } from "./accounts";
import { getBuyerState, getCustodianState, getSaleState } from "./fetch";
import { postVaa } from "./wormhole";
import { getPdaAssociatedTokenAddress, makeWritableAccountMeta } from "./utils";

export class IccoContributor {
  program: Program<AnchorContributor>;
  whMessageKey: web3.Keypair;
  custodianAccount: KeyBump;

  constructor(program: Program<AnchorContributor>) {
    this.program = program;
    this.custodianAccount = findCustodianAccount(this.program.programId);
  }

  async createCustodian(payer: web3.Keypair) {
    const program = this.program;
    await program.methods
      .createCustodian()
      .accounts({
        owner: payer.publicKey,
        custodian: this.custodianAccount.key,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async getCustodian() {
    return getCustodianState(this.program, this.custodianAccount);
  }

  async initSale(payer: web3.Keypair, initSaleVaa: Buffer, saleTokenMint: web3.PublicKey): Promise<string> {
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
        custodian: this.custodianAccount.key,
        sale: saleAccount.key,
        coreBridgeVaa: signedVaaAccount.key,
        saleTokenMint,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async contribute(payer: web3.Keypair, saleId: Buffer, mint: web3.PublicKey, amount: BN): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
    const saleAccount = findSaleAccount(program.programId, saleId);
    const buyerTokenAcct = await getAssociatedTokenAddress(mint, payer.publicKey);
    const custodianTokenAcct = await getPdaAssociatedTokenAddress(mint, custodian);

    return program.methods
      .contribute(amount)
      .accounts({
        custodian,
        sale: saleAccount.key,
        buyer: buyerAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
        buyerTokenAcct,
        custodianTokenAcct,
      })
      .signers([payer])
      .rpc();
  }

  async attestContributions(payer: web3.Keypair, saleId: Buffer) {
    const program = this.program;

    // Accounts
    const saleAcc = findSaleAccount(program.programId, saleId).key;
    const whCoreBridge = new web3.PublicKey("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o");
    const whConfig = findProgramAddressSync([Buffer.from("Bridge")], whCoreBridge)[0];
    const whFeeCollector = findProgramAddressSync([Buffer.from("fee_collector")], whCoreBridge)[0];
    const whDerivedEmitter = findProgramAddressSync([Buffer.from("emitter")], program.programId)[0];
    const whSequence = findProgramAddressSync([Buffer.from("Sequence"), whDerivedEmitter.toBytes()], whCoreBridge)[0];
    this.whMessageKey = web3.Keypair.generate();

    return program.methods
      .attestContributions()
      .accounts({
        sale: saleAcc,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
        coreBridge: whCoreBridge,
        wormholeConfig: whConfig,
        wormholeFeeCollector: whFeeCollector,
        wormholeDerivedEmitter: whDerivedEmitter,
        wormholeSequence: whSequence,
        wormholeMessageKey: this.whMessageKey.publicKey,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([payer, this.whMessageKey])
      .rpc();
  }


  async sealSale(payer: web3.Keypair, saleSealedVaa: Buffer, saleTokenMint: web3.PublicKey): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    // first post signed vaa to wormhole
    await postVaa(program.provider.connection, payer, saleSealedVaa);
    const signedVaaAccount = findSignedVaaAccount(saleSealedVaa);

    const saleId = await parseSaleId(saleSealedVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);
    const custodianSaleTokenAcct = await getPdaAssociatedTokenAddress(saleTokenMint, custodian);

    return program.methods
      .sealSale()
      .accounts({
        custodian,
        sale: saleAccount.key,
        coreBridgeVaa: signedVaaAccount.key,
        custodianSaleTokenAcct,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });
    //.rpc();
  }

  async sendContributions(payer: web3.Keypair, saleId: Buffer) {
    //Loop through each token and call send contributions for each one
    const program = this.program;
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

  async claimRefunds(payer: web3.Keypair, saleId: Buffer, mints: web3.PublicKey[]): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
    const saleAccount = findSaleAccount(program.programId, saleId);

    const remainingAccounts: web3.AccountMeta[] = [];

    // push custodian token accounts
    const custodianTokenAccounts = await Promise.all(
      mints.map(async (mint) => getPdaAssociatedTokenAddress(mint, custodian))
    );
    //    console.log("!!! Mints len: ", mints.length);
    remainingAccounts.push(
      ...custodianTokenAccounts.map((acct) => {
        return makeWritableAccountMeta(acct);
      })
    );

    // next buyers
    const buyerTokenAccounts = await Promise.all(
      mints.map(async (mint) => getAssociatedTokenAddress(mint, payer.publicKey))
    );
    remainingAccounts.push(
      ...buyerTokenAccounts.map((acct) => {
        return makeWritableAccountMeta(acct);
      })
    );

    return program.methods
      .claimRefunds()
      .accounts({
        custodian,
        sale: saleAccount.key,
        buyer: buyerAccount.key,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([payer])
      .remainingAccounts(remainingAccounts)
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
