import { getOriginalAssetSol, importCoreWasm, tryHexToNativeString } from "@certusone/wormhole-sdk";
import { BN, Program, web3 } from "@project-serum/anchor";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

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
import { getPdaAssociatedTokenAddress, hexToPublicKey, makeWritableAccountMeta } from "./utils";
import { CORE_BRIDGE_ADDRESS } from "./consts";
import { PostVaaMethod, SolanaAcceptedToken as AcceptedToken, SolanaAcceptedToken } from "./types";
import { serializeUint16 } from "byteify";

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
    const tokenBridgeAuthoritySigner = findProgramAddressSync([Buffer.from("authority_signer")], TokenBridge)[0];
    console.log("Token Bridge Authority Signer: ", tokenBridgeAuthoritySigner.toString());
    const tokenMintSigner = findProgramAddressSync([Buffer.from("mint_signer")], TokenBridge)[0];
    console.log("Token Bridge Mint Signer: ", tokenMintSigner.toString());
    const tokenConfigAcct = findProgramAddressSync([Buffer.from("config")], TokenBridge)[0];
    console.log("Token Config: ", tokenConfigAcct.toString());

    for (let token of acceptedTokens) {
      let tokenInfo = await getOriginalAssetSol(
        program.provider.connection,
        TokenBridge.toString(),
        tryHexToNativeString(token.address, "solana")
      );

      let custodySignerKey = findProgramAddressSync([Buffer.from("custody_signer")], TokenBridge)[0];
      console.log("Custody Signer: ", custodySignerKey.toString());

      let custodyKey;
      let wrappedMetaKey; //Null for Native Transfer
      console.log("Wtf");
      console.log(token.address, tryHexToNativeString(token.address, "solana"));
      const tokenAcc = await getMint(program.provider.connection, hexToPublicKey(token.address));
      console.log("are we here?");
      if (tokenAcc.mintAuthority == tokenMintSigner) {
        console.log("wrapped");
        //First derive the Wrapped Mint Key
        const wrappedMintKey = findProgramAddressSync(
          [
            Buffer.from("wrapped"),
            serializeUint16(tokenInfo.chainId),
            new web3.PublicKey(tryHexToNativeString(token.address, "solana")).toBytes(),
          ],
          TokenBridge
        )[0];
        //Then derive the Wrapped Meta Key
        wrappedMetaKey = findProgramAddressSync([Buffer.from("meta"), wrappedMintKey.toBytes()], TokenBridge)[0];
        custodyKey = web3.Keypair.generate().publicKey;
      } else {
        console.log("native");
        custodyKey = findProgramAddressSync([tokenInfo.assetAddress], TokenBridge)[0];
        wrappedMetaKey = web3.Keypair.generate().publicKey;
      }

      const coreConfig = findProgramAddressSync([Buffer.from("Bridge")], CORE_BRIDGE_ADDRESS)[0];

      const feeCollector = findProgramAddressSync([Buffer.from("fee_collector")], CORE_BRIDGE_ADDRESS)[0];

      const programEmitter = findProgramAddressSync([Buffer.from("emitter")], TokenBridge)[0];

      const sequence = findProgramAddressSync(
        [Buffer.from("Sequence"), programEmitter.toBytes()],
        CORE_BRIDGE_ADDRESS
      )[0];

      const msgKey = web3.Keypair.generate();

      const custodyAta = await getPdaAssociatedTokenAddress(
        new web3.PublicKey(tryHexToNativeString(token.address, "solana")),
        custodian
      );

      const sale = findSaleAccount(program.programId, saleId).key;
      const mintTokenAccount = hexToPublicKey(token.address);
      console.log("custodian", custodian.toString());
      console.log("sale", sale.toString());
      console.log("custodianAta", custodyAta.toString());
      console.log("mintTokenAccount", mintTokenAccount.toString());
      console.log("wrappedMetaKey", wrappedMetaKey.toString());
      console.log("custodyKey", custodyKey.toString());
      console.log("CustodySignerKey", custodySignerKey.toString());
      console.log("tokenMintSigner", tokenMintSigner.toString());
      console.log("tokenBridgeAuthoritySigner", tokenBridgeAuthoritySigner.toString());
      console.log("tokenConfigAcct", tokenConfigAcct.toString());
      console.log("programEmitter", programEmitter.toString());
      console.log("payer", payer.publicKey.toString());
      console.log("msgKey", msgKey.publicKey.toString());

      await program.methods
        .bridgeSealedContributions(token.index)
        .accounts({
          custodian,
          sale,
          custodyAta,
          mintTokenAccount,
          wrappedMetaKey,
          custodyKey,
          custodySignerKey,
          systemProgram: web3.SystemProgram.programId,
          tokenBridge: TokenBridge,
          tokenMintSigner,
          tokenBridgeAuthoritySigner,
          tokenConfig: tokenConfigAcct,
          coreBridge: CORE_BRIDGE_ADDRESS,
          wormholeConfig: coreConfig,
          wormholeFeeCollector: feeCollector,
          wormholeDerivedEmitter: programEmitter,
          wormholeSequence: sequence,
          wormholeMessageKey: msgKey.publicKey,
          payer: payer.publicKey,
          clock: web3.SYSVAR_CLOCK_PUBKEY,
          rent: web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payer, msgKey])
        .rpc({ skipPreflight: true });
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
