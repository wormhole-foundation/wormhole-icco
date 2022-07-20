import { ChainId, CHAIN_ID_ETH, CHAIN_ID_SOLANA, tryNativeToHexString } from "@certusone/wormhole-sdk";
import { web3, BN } from "@project-serum/anchor";
import * as BufferLayout from "@solana/buffer-layout";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as byteify from "byteify";
import { deriveAddress, toBigNumberHex } from "./utils";
import { hashVaaPayload, ParsedVaa, parseVaa, signAndEncodeVaa } from "./wormhole";
import { PostVaaMethod } from "./types";

export function encodeTokenBridgeRegistration(chain: ChainId, bridgeAddress: string) {
  const encoded = Buffer.alloc(69);

  // required label for governance
  const label = Buffer.from("TokenBridge");
  encoded.write(label.toString("hex"), 32 - label.length, "hex");
  encoded.writeUint8(1, 32);
  // skip 2 bytes
  encoded.writeUint16BE(chain as number, 35);
  encoded.write(tryNativeToHexString(bridgeAddress, chain), 37, "hex");

  return encoded;
}

export function encodeAttestMeta(
  tokenAddress: Buffer,
  tokenChain: number,
  decimals: number,
  symbol: string,
  name: string
) {
  if (tokenAddress.length != 32) {
    throw Error("tokenAddress.length != 32");
  }

  if (symbol.length > 64) {
    throw Error("symbol.length > 64");
  }

  if (name.length > 64) {
    throw Error("name.length > 64");
  }
  const encoded = Buffer.alloc(100);
  encoded.writeUint8(2, 0);
  encoded.write(tokenAddress.toString("hex"), 1, "hex");
  encoded.writeUint16BE(tokenChain, 33);
  encoded.writeUint8(decimals, 35);
  encoded.write(symbol, 36);
  encoded.write(name, 68);
  // console.log("buffer:\n", encoded.toString("hex"));
  return encoded;
}

export function encodeTokenTransfer(
  amount: string,
  tokenAddress: Buffer,
  tokenChain: number,
  receiver: web3.PublicKey
) {
  const encoded = Buffer.alloc(133);
  encoded.writeUint8(1, 0); // regular transfer
  encoded.write(toBigNumberHex(amount, 32), 1, "hex");
  encoded.write(tokenAddress.toString("hex"), 33, "hex");
  encoded.writeUint16BE(tokenChain, 65);
  encoded.write(tryNativeToHexString(receiver.toString(), CHAIN_ID_SOLANA), 67, "hex");
  encoded.writeUint16BE(CHAIN_ID_SOLANA as number, 99);

  // last 32 bytes is a fee, which we are setting to zero. So noop
  return encoded;
}

export interface ParsedAttestMetaVaa {
  core: ParsedVaa;
  address: Buffer;
  chain: ChainId;
  decimals: number;
  symbol: string;
  name: string;
}

export function parseAttestMetaVaa(signedVaa): ParsedAttestMetaVaa {
  const parsed = parseVaa(signedVaa);
  const data = parsed.data;
  return {
    core: parsed,
    address: data.subarray(1, 33),
    chain: data.readUint16BE(33) as ChainId,
    decimals: data[35],
    symbol: data.subarray(36, 68).toString().replace("\0", ""),
    name: data.subarray(68, 100).toString().replace("\0", ""),
  };
}

export interface ParsedTokenTransfer {
  core: ParsedVaa;
  messageType: number;
  amount: string;
  tokenAddress: Buffer;
  tokenChain: ChainId;
  receiver: Buffer;
  toChain: ChainId;
  fee: string;
  payload: Buffer;
}

export function parseTokenTransfer(signedVaa): ParsedTokenTransfer {
  const parsed = parseVaa(signedVaa);
  const data = parsed.data;

  return {
    core: parsed,
    messageType: data[0],
    amount: new BN(data.subarray(1, 33)).toString(),
    tokenAddress: data.subarray(33, 65),
    tokenChain: data.readUint16BE(65) as ChainId,
    receiver: data.subarray(67, 99),
    toChain: data.readUint16BE(99) as ChainId,
    fee: new BN(data.subarray(101, 133)).toString(),
    payload: data.subarray(133),
  };
}

// below is experimental and is not used in the program test

// Couldn't find an export in the spl token program so Dev just looked it up on rust docs
// https://docs.rs/spl-token-metadata/latest/src/spl_token_metadata/lib.rs.html#14
export const SPL_METADATA_PROGRAM = new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const CreateWrappedData = BufferLayout.struct<Readonly<{}>>([]);

export enum TokenBridgeInstruction {
  CreateWrapped = 7,
}

export class TokenBridgeProgram {
  connection: web3.Connection;
  programId: web3.PublicKey;
  wormhole: web3.PublicKey;
  postVaaWithRetry: PostVaaMethod;

  // pdas
  config: web3.PublicKey;
  mintAuthority: web3.PublicKey;

  constructor(
    connection: web3.Connection,
    programId: web3.PublicKey,
    wormhole: web3.PublicKey,
    postVaaWithRetry: PostVaaMethod
  ) {
    this.connection = connection;
    this.programId = programId;
    this.wormhole = wormhole;
    this.postVaaWithRetry = postVaaWithRetry;

    this.config = deriveAddress([Buffer.from("config")], this.programId);
    this.mintAuthority = deriveAddress([Buffer.from("mint_signer")], this.programId);
  }

  deriveEmitterPda(foreignChain: ChainId, foreignTokenBridge: Buffer) {
    return deriveAddress([byteify.serializeUint16(foreignChain as number), foreignTokenBridge], this.programId);
  }

  deriveMessagePda(hash: Buffer) {
    return deriveAddress([Buffer.from("PostedVAA"), hash], this.wormhole);
  }

  deriveClaimPda(foreignChain: ChainId, foreignTokenBridge: Buffer, sequence: bigint) {
    return deriveAddress(
      [foreignTokenBridge, byteify.serializeUint16(foreignChain as number), byteify.serializeUint64(Number(sequence))],
      this.programId
    );
  }

  deriveMintPdas(tokenChain: ChainId, tokenAddress: Buffer) {
    const programId = this.programId;
    const mintKey = deriveAddress(
      [Buffer.from("wrapped"), byteify.serializeUint16(tokenChain), tokenAddress],
      programId
    );
    const mintMetaKey = deriveAddress([Buffer.from("meta"), mintKey.toBuffer()], programId);
    return [mintKey, mintMetaKey];
  }

  async createWrapped(payer: web3.Keypair, attestMetaSignedVaa: Buffer) {
    // first post signed vaa to wormhole
    console.log("posting");
    await this.postVaa(payer, attestMetaSignedVaa);
    console.log("posted");

    // Deserialize signed vaa
    const attestedMeta = parseAttestMetaVaa(attestMetaSignedVaa);
    const core = attestedMeta.core;

    // All the keys
    const token_config_acc = this.config;
    const endpoint_acc = this.deriveEmitterPda(core.emitterChain, core.emitterAddress);
    const coreVaa = this.deriveMessagePda(core.hash);
    console.log("coreVaa", coreVaa.toString());

    const tokenVaa = this.deriveClaimPda(core.emitterChain, core.emitterAddress, core.sequence);
    const [mintKey, mintMetaKey] = this.deriveMintPdas(attestedMeta.chain, attestedMeta.address);

    const splMetadata = deriveAddress(
      [Buffer.from("metadata"), SPL_METADATA_PROGRAM.toBuffer(), mintKey.toBuffer()],
      SPL_METADATA_PROGRAM
    );

    const mintAuthorityKey = this.mintAuthority;

    const createWrappedKeys: web3.AccountMeta[] = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: token_config_acc, isSigner: false, isWritable: false },
      { pubkey: endpoint_acc, isSigner: false, isWritable: false },
      { pubkey: coreVaa, isSigner: false, isWritable: false },
      { pubkey: tokenVaa, isSigner: false, isWritable: true },
      { pubkey: mintKey, isSigner: false, isWritable: true },
      { pubkey: mintMetaKey, isSigner: false, isWritable: true },
      { pubkey: splMetadata, isSigner: false, isWritable: true },
      { pubkey: mintAuthorityKey, isSigner: false, isWritable: false },
      { pubkey: web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: this.wormhole, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_METADATA_PROGRAM, isSigner: false, isWritable: false },
    ];
    console.log(createWrappedKeys);
    const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
    let transaction = new web3.Transaction({
      feePayer: payer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
    /*
    let createWrappedStruct = {
      index: TokenBridgeInstruction.CreateWrapped,
      layout: BufferLayout.struct([]), //CreateWrapped takes no arguements
    };
    let data = Buffer.alloc(createWrappedStruct.layout.span);
    let layoutFields = Object.assign({ instruction: createWrappedStruct.index }, {});
    createWrappedStruct.layout.encode(layoutFields, data);
    console.log("createWrappedStruct", createWrappedStruct);
    */
    const instructionData = Buffer.alloc(1);
    instructionData.writeUint8(7);

    transaction.add(
      new web3.TransactionInstruction({
        keys: createWrappedKeys,
        programId: this.programId,
        data: instructionData,
      })
    );

    console.log("transaction", transaction);
    transaction.partialSign(payer);

    const response = await this.connection
      .sendRawTransaction(transaction.serialize(), { skipPreflight: true })
      .then((tx) => this.connection.confirmTransaction(tx, "confirmed"));

    return response;
  }

  async postVaa(payer: web3.Keypair, signedVaa: Buffer): Promise<void> {
    //return postVaa(this.program.provider.connection, payer, this.wormhole, signedVaa);
    await this.postVaaWithRetry(
      this.connection,
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
}

export class DummyEthTokenBridge {
  emitterChain: ChainId;
  emitterAddress: Buffer;
  sequence: number;

  constructor(address: string) {
    this.emitterChain = CHAIN_ID_ETH;
    this.emitterAddress = Buffer.from(tryNativeToHexString(address, this.emitterChain), "hex");

    // uptick this
    this.sequence = 0;
  }

  attestMeta(tokenAddress: Buffer, tokenChain: ChainId, decimals: number, symbol: string, name: string) {
    return signAndEncodeVaa(
      0,
      0,
      this.emitterChain as number,
      this.emitterAddress,
      1,
      encodeAttestMeta(tokenAddress, tokenChain, decimals, symbol, name)
    );
  }
}
