import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import {
  tryNativeToUint8Array,
  postVaaSolanaWithRetry,
  importCoreWasm,
  setDefaultWasm,
  tryNativeToHexString,
  CHAIN_ID_SOLANA,
  CHAIN_ID_ETH,
} from "@certusone/wormhole-sdk";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import fs from "fs";
import * as b from "byteify";
import keccak256 from "keccak256";
import { parseSaleInit } from "../../sdk/js/src/icco/signedVaa";
import { AcceptedToken, encodeSaleInit, signAndEncodeVaa } from "./lib";

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.AnchorContributor as Program<AnchorContributor>;

  const CONDUCTOR_CHAIN = CHAIN_ID_ETH as number;
  const CONDUCTOR_ADDRESS = tryNativeToUint8Array("0x5c49f34D92316A2ac68d10A1e2168e16610e84f9", CHAIN_ID_ETH);
  const owner = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("./tests/test_keypair.json").toString()))
  );
  const CORE_BRIDGE_ADDRESS = new anchor.web3.PublicKey("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o");

  const [contributor_acc, contributor_bmp] = findProgramAddressSync(
    [Buffer.from("contributor"), CONDUCTOR_ADDRESS],
    program.programId
  );

  it("creates conductor", async () => {
    await program.methods
      .createContributor(CONDUCTOR_CHAIN, Buffer.from(CONDUCTOR_ADDRESS))
      .accounts({
        owner: owner.publicKey,
        contributor: contributor_acc,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(await program.account.contributor.fetch(contributor_acc));
  });

  it("initalizes a sale", async () => {
    //console.log(await program.provider.connection.getAccountInfo(new anchor.web3.PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5")));

    // set up saleInit vaa
    const saleId = 1;
    const tokenAddress = "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db";
    const tokenChain = 2;
    const tokenDecimals = 18;
    const tokenAmount = "1000000000000000000";
    const minRaise = "10000000000000000000";
    const maxRaise = "14000000000000000000";

    // set up sale time based on block time
    const blockTime = 0; //await getBlockTime(terra);
    const saleStart = blockTime + 5;
    const saleEnd = blockTime + 35;

    const acceptedTokens: AcceptedToken[] = [
      {
        address: tryNativeToHexString("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", CHAIN_ID_ETH),
        chain: CHAIN_ID_ETH as number,
        conversionRate: "1000000000000000000",
      },
      {
        address: tryNativeToHexString("So11111111111111111111111111111111111111112", CHAIN_ID_SOLANA),
        chain: CHAIN_ID_SOLANA as number,
        conversionRate: "1000000000000000000",
      },
      {
        address: tryNativeToHexString("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", CHAIN_ID_ETH),
        chain: CHAIN_ID_ETH as number,
        conversionRate: "1000000000000000000",
      },
    ];

    const recipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
    const refundRecipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";

    const timestamp = 1;
    const nonce = 0;
    const sequence = 3;

    const initSaleVaa = signAndEncodeVaa(
      timestamp,
      nonce,
      CONDUCTOR_CHAIN,
      Buffer.from(CONDUCTOR_ADDRESS).toString("hex"),
      sequence,
      encodeSaleInit(
        saleId,
        tokenAddress,
        tokenChain,
        tokenDecimals,
        tokenAmount,
        minRaise,
        maxRaise,
        saleStart,
        saleEnd,
        acceptedTokens,
        recipient,
        refundRecipient
      )
    );

    //const initSaleVaa =
    //  "01000000000100ef188aec456b284bc9f94a8d229a037eb83ffbdf29191ef12a56097f3d39c1bc2c4c27bcf1b84c38637d0f043bea8c462faf12cb34f2d70555b5930d6e2f8b6d01000006d70000000000020000000000000000000000004cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee00000000000000010f010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000ac92a45c2b0ce520e12dd696af589073e86b2f470002120000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000c249fdd32778000000000000000000000000000000000000000000000000000000000000000006d8000000000000000000000000000000000000000000000000000000000000071405000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000200000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c0002000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000de0b6b3a7640000165809739240a0ac03b98440fe8985548e3aa683cd0d4d9df5b5659669faa301000100000000000000000de0b6b3a7640000000000000000000000000000ac92a45c2b0ce520e12dd696af589073e86b2f4700000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
    setDefaultWasm("node");
    const { parse_vaa } = await importCoreWasm();
    const parsedVaa = parse_vaa(initSaleVaa);
    //console.log(JSON.stringify(parse_vaa(Buffer.from(initSaleVaa, "hex")), null, 2));


    //Post VAA to Core Bridge
    await postVaaSolanaWithRetry(
      program.provider.connection,
      async (tx) => {
        tx.partialSign(owner);
        return tx;
      },
      CORE_BRIDGE_ADDRESS.toString(),
      owner.publicKey.toString(),
      initSaleVaa,
      10
    );
    await new Promise((r) => setTimeout(r, 5000));

    const [sale_acc, sale_bmp] = findProgramAddressSync(
      [Buffer.from("icco-sale"), parsedVaa.payload.slice(1, 33)],
      program.programId
    );

    const createSaleIx = await program.account.sale.createInstruction(sale_acc)

    //Find the Core Bridge VAA address (uses hash of)
    //Create VAA Hash to use in core bridge key
    let buffer_array = [];
    buffer_array.push(b.serializeUint32(parsedVaa.timestamp));
    buffer_array.push(b.serializeUint32(parsedVaa.nonce));
    buffer_array.push(b.serializeUint16(parsedVaa.emitter_chain));
    buffer_array.push(Uint8Array.from(parsedVaa.emitter_address));
    buffer_array.push(b.serializeUint64(parsedVaa.sequence));
    buffer_array.push(b.serializeUint8(parsedVaa.consistency_level));
    buffer_array.push(Uint8Array.from(parsedVaa.payload));
    const hash = keccak256(Buffer.concat(buffer_array));
    console.log("hash", hash);

    let core_bridge_vaa_key = findProgramAddressSync([Buffer.from("PostedVAA"), hash], CORE_BRIDGE_ADDRESS)[0];
    console.log("Core Bridge VAA: ", await program.provider.connection.getAccountInfo(core_bridge_vaa_key));

    // Call Init Sale
    await program.methods
      .initSale()
      .accounts({
        contributor: contributor_acc,
        sale: sale_acc,
        coreBridgeVaa: core_bridge_vaa_key,
        owner: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(await program.account.sale.fetch(sale_acc));
  });
});
