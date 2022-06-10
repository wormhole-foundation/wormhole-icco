import { tryHexToNativeString } from "@certusone/wormhole-sdk";
import { BN, Program, web3 } from "@project-serum/anchor";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import { getAccount, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

import {
  findAttestContributionsMsgAccount,
  findBuyerAccount,
  findCustodianAccount,
  findKeyBump,
  findSaleAccount,
  findSignedVaaAccount,
  KeyBump,
} from "./accounts";
import { getBuyerState, getCustodianState, getSaleState } from "./fetch";
import { getPdaAssociatedTokenAddress, makeWritableAccountMeta } from "./utils";
import { SolanaAcceptedToken, PostVaaMethod } from "./types";

export class IccoContributor {
  program: Program<AnchorContributor>;
  wormhole: web3.PublicKey;
  postVaaWithRetry: PostVaaMethod;

  whMessageKey: web3.Keypair;
  custodianAccount: KeyBump;

  constructor(program: Program<AnchorContributor>, wormhole: web3.PublicKey, postVaaWithRetry: PostVaaMethod) {
    this.program = program;
    this.wormhole = wormhole;
    this.postVaaWithRetry = postVaaWithRetry;
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

    const custodian = this.custodianAccount.key;

    // first post signed vaa to wormhole
    await this.postVaa(payer, initSaleVaa);
    const coreBridgeVaa = this.findSignedVaaAccount(initSaleVaa);

    const saleId = await parseSaleId(initSaleVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);
    const custodianSaleTokenAcct = await getPdaAssociatedTokenAddress(saleTokenMint, custodian);

    return program.methods
      .initSale()
      .accounts({
        custodian,
        sale: saleAccount.key,
        coreBridgeVaa,
        saleTokenMint,
        custodianSaleTokenAcct,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async contribute(
    payer: web3.Keypair,
    saleId: Buffer,
    tokenIndex: number,
    amount: BN,
    kycSignature: Buffer
  ): Promise<string> {
    // first find mint
    const state = await this.getSale(saleId);

    const totals: any = state.totals;
    const found = totals.find((item) => item.tokenIndex == tokenIndex);
    if (found == undefined) {
      throw "tokenIndex not found";
    }

    const mint = found.mint;

    // now prepare instruction
    const program = this.program;

    const custodian = this.custodianAccount.key;

    const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
    const saleAccount = findSaleAccount(program.programId, saleId);
    const buyerTokenAcct = await getAssociatedTokenAddress(mint, payer.publicKey);
    const custodianTokenAcct = await getPdaAssociatedTokenAddress(mint, custodian);

    return (
      program.methods
        .contribute(amount, kycSignature)
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
        //.rpc();
        .rpc({ skipPreflight: true })
    );
  }

  async attestContributions(payer: web3.Keypair, saleId: Buffer) {
    const program = this.program;
    const coreBridge = this.wormhole;

    // Accounts
    const saleAcc = findSaleAccount(program.programId, saleId).key;
    const wormholeConfig = findKeyBump([Buffer.from("Bridge")], coreBridge).key;
    const wormholeFeeCollector = findKeyBump([Buffer.from("fee_collector")], coreBridge).key;
    const wormholeDerivedEmitter = findKeyBump([Buffer.from("emitter")], program.programId).key;
    const wormholeSequence = findKeyBump([Buffer.from("Sequence"), wormholeDerivedEmitter.toBytes()], coreBridge).key;
    const vaaMsgAcct = findAttestContributionsMsgAccount(program.programId, saleId).key;

    return program.methods
      .attestContributions()
      .accounts({
        sale: saleAcc,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
        coreBridge,
        wormholeConfig,
        wormholeFeeCollector,
        wormholeDerivedEmitter,
        wormholeSequence,
        vaaMsgAcct,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([payer])
      .rpc();
  }

  async sealSale(payer: web3.Keypair, saleSealedVaa: Buffer, saleTokenMint: web3.PublicKey): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    // first post signed vaa to wormhole
    await this.postVaa(payer, saleSealedVaa);
    const coreBridgeVaa = this.findSignedVaaAccount(saleSealedVaa);

    const saleId = await parseSaleId(saleSealedVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);
    const custodianSaleTokenAcct = await getPdaAssociatedTokenAddress(saleTokenMint, custodian);

    return program.methods
      .sealSale()
      .accounts({
        custodian,
        sale: saleAccount.key,
        coreBridgeVaa,
        custodianSaleTokenAcct,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  }

  async sendContributions(payer: web3.Keypair, saleId: Buffer, acceptedTokens: SolanaAcceptedToken[]) {
    //Loop through each token and call send contributions for each one
    const program = this.program;

    const custodian = this.custodianAccount.key;
    const sale = findSaleAccount(program.programId, saleId).key;
    const TokenBridge = new web3.PublicKey("B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE");
    const tokenBridgeMintSigner = findProgramAddressSync([Buffer.from("mint_signer")], TokenBridge)[0];
    console.log("Token Bridge Mint Signer: ", tokenBridgeMintSigner);

    const isTokenWrapped = async (address: web3.PublicKey) => {
      //Get the token info and check mint is Token Bridge Mint Signer
      const tokenAcc = await getAccount(program.provider.connection, address);
      if (tokenAcc.mint == tokenBridgeMintSigner) {
        return true;
      } else {
        return false;
      }
    };

    for (let token of acceptedTokens) {
      let wrappedMetaKey = new web3.PublicKey("");
      if (isTokenWrapped(new web3.PublicKey(token.address))) {
        wrappedMetaKey; //TODO::!
      }

      await program.methods
        .bridgeSealedContributions(token.index)
        .accounts({
          custodian: this.custodianAccount.key,
          sale: findSaleAccount(program.programId, saleId).key,
          custodyAta: await getPdaAssociatedTokenAddress(
            new web3.PublicKey(tryHexToNativeString(token.address, "solana")),
            custodian
          ),
          mintTokenAccount: new web3.PublicKey(tryHexToNativeString(token.address, "solana")),
        })
        .rpc();
    }
  }

  async abortSale(payer: web3.Keypair, saleAbortedVaa: Buffer): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    // first post signed vaa to wormhole
    await this.postVaa(payer, saleAbortedVaa);
    const coreBridgeVaa = this.findSignedVaaAccount(saleAbortedVaa);

    const saleId = await parseSaleId(saleAbortedVaa);
    const saleAccount = findSaleAccount(program.programId, saleId);

    return program.methods
      .abortSale()
      .accounts({
        custodian,
        sale: saleAccount.key,
        coreBridgeVaa,
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

  async claimAllocation(
    payer: web3.Keypair,
    saleId: Buffer,
    saleTokenMint: web3.PublicKey,
    mints: web3.PublicKey[]
  ): Promise<string> {
    const program = this.program;

    const custodian = this.custodianAccount.key;

    const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
    const saleAccount = findSaleAccount(program.programId, saleId);

    const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      payer,
      saleTokenMint,
      payer.publicKey
    );
    const buyerSaleTokenAcct = buyerTokenAccount.address;
    const custodianSaleTokenAcct = await getPdaAssociatedTokenAddress(saleTokenMint, custodian);

    const remainingAccounts: web3.AccountMeta[] = [];

    // push custodian token accounts
    const custodianTokenAccounts = await Promise.all(
      mints.map(async (mint) => getPdaAssociatedTokenAddress(mint, custodian))
    );
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
      .claimAllocation()
      .accounts({
        custodian,
        sale: saleAccount.key,
        buyer: buyerAccount.key,
        buyerSaleTokenAcct,
        custodianSaleTokenAcct,
        owner: payer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([payer])
      .remainingAccounts(remainingAccounts)
      .rpc();
    //.rpc({ skipPreflight: true });
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

  async postVaa(payer: web3.Keypair, signedVaa: Buffer): Promise<void> {
    //return postVaa(this.program.provider.connection, payer, this.wormhole, signedVaa);
    await this.postVaaWithRetry(
      this.program.provider.connection,
      async (tx) => {
        tx.partialSign(payer);
        return tx;
      },
      this.wormhole.toString(),
      payer.publicKey.toString(),
      signedVaa,
      10
    );
  }

  findSignedVaaAccount(signedVaa: Buffer): web3.PublicKey {
    return findSignedVaaAccount(this.wormhole, signedVaa).key;
  }
}

async function parseSaleId(iccoVaa: Buffer): Promise<Buffer> {
  //const { parse_vaa } = await importCoreWasm();
  const numSigners = iccoVaa[5];
  const payloadStart = 57 + 66 * numSigners;
  return iccoVaa.subarray(payloadStart + 1, payloadStart + 33);
}
