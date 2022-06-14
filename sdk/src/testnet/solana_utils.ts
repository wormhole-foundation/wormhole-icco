import {
  TESTNET_ADDRESSES,
  SOLANA_RPC,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SALE_CONFIG,
  SOLANA_IDL,
  CHAIN_ID_TO_NETWORK,
  WORMHOLE_ADDRESSES,
} from "./consts";
import {
  postVaaSolanaWithRetry,
  parseSequenceFromLogSolana,
  getEmitterAddressSolana,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { AnchorContributor } from "./anchor_contributor";
import { AnchorProvider, web3, Program, BN } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { SolanaSaleInit, Contribution } from "./structs";
import keccak256 from "keccak256";
import { extractVaaPayload, getSignedVaaFromSequence, collectContributionsOnConductor, parseVaaPayload } from "./utils";
import { parseSolanaSaleInit, SolanaToken } from "../../src";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { importCoreWasm, CHAIN_ID_SOLANA, tryHexToNativeString } from "@certusone/wormhole-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  getMint,
  mintTo,
  getAssociatedTokenAddress,
  Account as AssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { ethers } from "ethers";

export type KeyBump = {
  key: web3.PublicKey;
  bump: number;
};

async function parseSaleId(iccoSaleInit: Buffer): Promise<Buffer> {
  const { parse_vaa } = await importCoreWasm();
  return Buffer.from(parse_vaa(iccoSaleInit).payload).subarray(1, 33);
}

export function findCustodianAccount(programId: web3.PublicKey): KeyBump {
  return findKeyBump([Buffer.from("icco-custodian")], programId);
}

export function findBuyerAccount(programId: web3.PublicKey, saleId: Buffer, buyer: web3.PublicKey): KeyBump {
  return findKeyBump([Buffer.from("icco-buyer"), saleId, buyer.toBuffer()], programId);
}

export function findSaleAccount(programId: web3.PublicKey, saleId: Buffer): KeyBump {
  return findKeyBump([Buffer.from("icco-sale"), saleId], programId);
}

export async function getPdaAssociatedTokenAddress(mint: web3.PublicKey, pda: web3.PublicKey): Promise<web3.PublicKey> {
  return getAssociatedTokenAddress(mint, pda, true);
}

export function hashVaaPayload(signedVaa: Buffer): Buffer {
  const sigStart = 6;
  const numSigners = signedVaa[5];
  const sigLength = 66;
  const bodyStart = sigStart + sigLength * numSigners;
  return keccak256(signedVaa.subarray(bodyStart));
}

function findKeyBump(seeds: (Buffer | Uint8Array)[], program: web3.PublicKey): KeyBump {
  const [key, bump] = findProgramAddressSync(seeds, program);
  return {
    key,
    bump,
  };
}

export function findSignedVaaAccount(signedVaa: Buffer): KeyBump {
  const hash = hashVaaPayload(signedVaa);
  return findKeyBump([Buffer.from("PostedVAA"), hash], SOLANA_CORE_BRIDGE_ADDRESS);
}

export function createContributorProgram(): Program<AnchorContributor> {
  const program = new Program<AnchorContributor>(
    SOLANA_IDL,
    TESTNET_ADDRESSES["solana_testnet"],
    new AnchorProvider(new web3.Connection(SOLANA_RPC), new NodeWallet(initiatorKeyPair()), {})
  );
  return program;
}

export async function postVaa(connection: web3.Connection, payer: web3.Keypair, signedVaa: Buffer): Promise<void> {
  await postVaaSolanaWithRetry(
    connection,
    async (tx) => {
      tx.partialSign(payer);
      return tx;
    },
    SOLANA_CORE_BRIDGE_ADDRESS.toString(),
    payer.publicKey.toString(),
    signedVaa,
    10
  );
}

export function initiatorKeyPair(): web3.Keypair {
  // solana wallet for the initiator
  const key = SALE_CONFIG["initiatorWallet"]["solana_testnet"].key;
  const keypair = web3.Keypair.fromSecretKey(Uint8Array.from(key));
  return keypair;
}

export async function createCustodian(payer: web3.Keypair, program: Program<AnchorContributor>) {
  const custodianAccount = findCustodianAccount(program.programId);
  await program.methods
    .createCustodian()
    .accounts({
      owner: payer.publicKey,
      custodian: custodianAccount.key,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();
}

export async function createCustodianATAs(
  program: Program<AnchorContributor>,
  custodianAccount: KeyBump,
  acceptedTokens: SolanaToken[]
) {
  for (const token of acceptedTokens) {
    const mint = new web3.PublicKey(tryHexToNativeString(token.tokenAddress.toString(), CHAIN_ID_SOLANA));

    const allowOwnerOffCurve = true;
    await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      initiatorKeyPair(),
      mint,
      custodianAccount.key,
      allowOwnerOffCurve
    );
  }
}

export async function createCustodianATAForSaleToken(program: Program<AnchorContributor>, saleTokenAddress: string) {
  // fetch custodian account
  const custodianAccount = findCustodianAccount(program.programId);

  // fetch mint
  const mint = new web3.PublicKey(tryHexToNativeString(saleTokenAddress, CHAIN_ID_SOLANA));

  console.log(mint);

  const allowOwnerOffCurve = true;
  await getOrCreateAssociatedTokenAccount(
    program.provider.connection,
    initiatorKeyPair(),
    mint,
    custodianAccount.key,
    allowOwnerOffCurve
  );
}

export async function initializeSaleOnSolanaContributor(
  program: Program<AnchorContributor>,
  initSaleVaa: Buffer
): Promise<SolanaSaleInit> {
  // grab the conductors keypair
  const payer = initiatorKeyPair();

  // see if the custodian account exists
  const custodianAccount = findCustodianAccount(program.programId);
  let custodianCheck;
  try {
    custodianCheck = await program.account.custodian.fetch(custodianAccount.key);
  } catch {
    custodianCheck = null;
  }

  // create custodian
  if (custodianCheck == null) {
    console.log("Creating custody account for Contributor program.");
    await createCustodian(payer, program);
  }

  const saleInitPayload = await extractVaaPayload(initSaleVaa);
  const solanaSaleInit = await parseSolanaSaleInit(saleInitPayload);

  // create ATA for solana tokens
  await createCustodianATAs(program, custodianAccount, solanaSaleInit.acceptedTokens);

  // first post signed vaa to wormhole
  await postVaa(program.provider.connection, payer, initSaleVaa);
  const signedVaaAccount = findSignedVaaAccount(initSaleVaa);

  const saleId = await parseSaleId(initSaleVaa);
  const saleAccount = findSaleAccount(program.programId, saleId);

  await program.methods
    .initSale()
    .accounts({
      sale: saleAccount.key,
      coreBridgeVaa: signedVaaAccount.key,
      owner: payer.publicKey,
      systemProgram: web3.SystemProgram.programId,
      custodian: custodianAccount.key,
    })
    .rpc();
  return solanaSaleInit;
}

async function contribute(
  program: Program<AnchorContributor>,
  payer: web3.Keypair,
  saleId: Buffer,
  mint: web3.PublicKey,
  amount: BN,
  custodianAccount: KeyBump
): Promise<string> {
  const custodian = custodianAccount.key;

  const buyerAccount = findBuyerAccount(program.programId, saleId, payer.publicKey);
  const saleAccount = findSaleAccount(program.programId, saleId);
  const buyerAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const custodianAta = await getPdaAssociatedTokenAddress(mint, custodian);

  return program.methods
    .contribute(amount)
    .accounts({
      custodian,
      sale: saleAccount.key,
      buyer: buyerAccount.key,
      owner: payer.publicKey,
      systemProgram: web3.SystemProgram.programId,
      buyerAta,
      custodianAta,
    })
    .signers([payer])
    .rpc({ skipPreflight: true });
}

export async function prepareAndExecuteContributionOnSolana(
  program: Program<AnchorContributor>,
  initSaleVaa: Buffer,
  contribution: Contribution
): Promise<boolean> {
  // get custodian account
  const custodianAccount = findCustodianAccount(program.programId);

  // process info before contributing
  const key = Buffer.from(contribution.key);
  const buyer = web3.Keypair.fromSecretKey(Uint8Array.from(key));
  const mint = new web3.PublicKey(contribution.address.toString());

  // fetch the token decimals and format the amount
  const mintContract = await getMint(program.provider.connection, mint);
  const decimals = await mintContract.decimals;
  const amount = new BN(ethers.utils.parseUnits(contribution.amount, decimals).toString());

  // grab the saleId from the initSale Vaa
  const saleId = await parseSaleId(initSaleVaa);

  try {
    await contribute(program, buyer, saleId, mint, amount, custodianAccount);
    return true;
  } catch (error: any) {
    console.log("Error:", error.toString());
    return false;
  }
}

async function attestContributions(program: Program<AnchorContributor>, payer: web3.Keypair, saleId: Buffer) {
  // Accounts
  const saleAcc = findSaleAccount(program.programId, saleId).key;
  const whCoreBridge = new web3.PublicKey(WORMHOLE_ADDRESSES["solana_testnet"].wormhole);
  const whConfig = findProgramAddressSync([Buffer.from("Bridge")], whCoreBridge)[0];
  const whFeeCollector = findProgramAddressSync([Buffer.from("fee_collector")], whCoreBridge)[0];
  const whDerivedEmitter = findProgramAddressSync([Buffer.from("emitter")], program.programId)[0];
  const whSequence = findProgramAddressSync([Buffer.from("Sequence"), whDerivedEmitter.toBytes()], whCoreBridge)[0];
  const whMessageKey = web3.Keypair.generate();

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
      wormholeMessageKey: whMessageKey.publicKey,
      clock: web3.SYSVAR_CLOCK_PUBKEY,
      rent: web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([payer, whMessageKey])
    .rpc();
}

export async function attestAndCollectContributionsOnSolana(
  program: Program<AnchorContributor>,
  initSaleVaa: Buffer,
  parsedSaleInit: SolanaSaleInit
): Promise<void> {
  // grab the saleId from the initSale Vaa
  const saleId = await parseSaleId(initSaleVaa);
  const tx = await attestContributions(program, initiatorKeyPair(), saleId);
  const seq = parseSequenceFromLogSolana(await program.provider.connection.getTransaction(tx));
  console.log("Sequence: ", seq);
  const emitterAddress = await getEmitterAddressSolana(program.programId.toString());
  console.log("Emitter Addresss: ", emitterAddress);

  // fetch the signedVaa
  const signedVaa = await getSignedVaaFromSequence(CHAIN_ID_SOLANA, emitterAddress, seq);

  // collect the contribution on the conductor
  const vaa = await parseVaaPayload(signedVaa);
  console.log(vaa);
  await collectContributionsOnConductor([signedVaa], parsedSaleInit.saleId);
}
