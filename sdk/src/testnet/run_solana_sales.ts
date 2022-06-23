import { expect } from "chai";
import { web3 } from "@project-serum/anchor";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ethers } from "ethers";
import {
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
  createWrappedOnEth,
  getForeignAssetSolana,
  getSignedVAAWithRetry,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  parseSequencesFromLogEth,
  postVaaSolanaWithRetry,
  redeemOnEth,
  setDefaultWasm,
  transferFromEthNative,
  tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

import { IccoConductor as EvmConductor } from "../evm/conductor";
import { IccoContributor as SolanaContributor } from "../anchor/contributor";

import {
  AVAX_CORE_BRIDGE_ADDRESS,
  AVAX_TOKEN_BRIDGE_ADDRESS,
  KYC_AUTHORITY,
  REPO_PATH,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SOLANA_TOKEN_BRIDGE_ADDRESS,
  WAVAX_ADDRESS,
  WORMHOLE_RPCS,
} from "./consts";
import { connectToContributorProgram } from "./solana";
import { readJson } from "./io";
import { Purse } from "./purse";
import {
  attestMintFromSolana,
  getSignedVaaFromAvaxTokenBridge,
  getSignedVaaFromSolanaTokenBridge,
  postAndRedeemTransferVaa,
  transferFromSolanaToEvm,
} from "./utils";
import { parseIccoHeader, SaleParameters } from "../utils";

setDefaultWasm("node");

describe("Testnet ICCO Sales", () => {
  // warehouse wallets from various chains
  if (!process.env.TESTNET_WALLETS) {
    throw Error("TESTNET_WALLETS not found in environment");
  }
  const purse = new Purse(process.env.TESTNET_WALLETS);

  // providers
  const avaxConnection = purse.avax.provider;
  const solanaConnection = purse.solana.provider;

  // establish orchestrator's wallet
  const avaxOrchestrator = purse.getEvmWallet(CHAIN_ID_AVAX, 0);
  console.log(`avaxOrchestrator: ${avaxOrchestrator.address}`);

  const solanaOrchestrator = purse.getSolanaWallet(0);
  console.log(`solanaOrchestrator: ${solanaOrchestrator.publicKey.toString()}`);

  // and buyers
  const buyers = [purse.getSolanaWallet(1), purse.getSolanaWallet(2)];
  for (let i = 0; i < buyers.length; ++i) {
    console.log(`buyer ${i}: ${buyers[i].publicKey.toString()}`);
  }

  // connect to contracts
  const addresses = readJson(REPO_PATH + "/testnet.json");

  // avax conductor
  const conductorChain = addresses.conductorChain;
  const conductor = new EvmConductor(
    addresses.conductorAddress,
    addresses.conductorChain,
    avaxOrchestrator,
    AVAX_CORE_BRIDGE_ADDRESS,
    AVAX_TOKEN_BRIDGE_ADDRESS
  );

  // solana contributor
  const solanaContributorProgramId = new web3.PublicKey(addresses.solana_devnet); // consider renaming to solanaDevnet in testnet.json?
  const solanaContributor = new SolanaContributor(
    connectToContributorProgram(purse.solana.endpoint, solanaOrchestrator, solanaContributorProgramId),
    SOLANA_CORE_BRIDGE_ADDRESS,
    SOLANA_TOKEN_BRIDGE_ADDRESS,
    postVaaSolanaWithRetry
  );

  // warehouse parameters
  const parameters = new SaleParameters(conductorChain);

  before("Check Balances", async () => {
    // need at least 2.5 AVAX to proceed with the test
    const avaxBalance = await avaxConnection.getBalance(avaxOrchestrator.address);
    expect(avaxBalance.gte(ethers.utils.parseUnits("2.5"))).to.be.true;

    // need at least 1 SOL to proceed with the test
    const solBalance = await solanaConnection.getBalance(solanaOrchestrator.publicKey);
    expect(solBalance >= 1).to.be.true;
  });

  describe("Test Preparation", () => {
    it("Create Sale Token", async () => {
      const saleTokenMint = await createMint(
        solanaConnection,
        solanaOrchestrator,
        solanaOrchestrator.publicKey,
        solanaOrchestrator.publicKey,
        9
      );
      console.log(`created sale token: ${saleTokenMint.toString()}`);

      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        solanaConnection,
        solanaOrchestrator,
        saleTokenMint,
        solanaOrchestrator.publicKey
      );

      await mintTo(
        solanaConnection,
        solanaOrchestrator,
        saleTokenMint,
        tokenAccount.address,
        solanaOrchestrator,
        10_000_000_000_000_000_000n // 10,000,000
      );

      // attest
      {
        const response = await attestMintFromSolana(solanaConnection, solanaOrchestrator, saleTokenMint);
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`attestMintFromSolana, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxTx = await createWrappedOnEth(AVAX_TOKEN_BRIDGE_ADDRESS, avaxOrchestrator, signedVaa);
        console.log(`avaxTx: ${avaxTx.transactionHash}`);
      }

      // transfer
      {
        const response = await transferFromSolanaToEvm(
          solanaConnection,
          solanaOrchestrator,
          saleTokenMint,
          2_000_000_000_000_000_000n, // 10% of tokens per sale
          CHAIN_ID_AVAX,
          avaxOrchestrator.address
        );
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`transferFromSolanaToEvm, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxTx = await redeemOnEth(AVAX_TOKEN_BRIDGE_ADDRESS, avaxOrchestrator, signedVaa);
        console.log(`avaxTx: ${avaxTx.transactionHash}`);
      }

      parameters.setSaleToken(CHAIN_ID_SOLANA, saleTokenMint.toString());
    });

    it("Prepare Native Solana Mint as Collateral", async () => {
      // we're going to pretend this is a stablecoin pegged to USDC price
      const mint = await createMint(
        solanaConnection,
        solanaOrchestrator,
        solanaOrchestrator.publicKey,
        solanaOrchestrator.publicKey,
        6 // same as USDC decimals
      );

      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          solanaOrchestrator,
          mint,
          buyer.publicKey
        );
        await mintTo(
          solanaConnection,
          solanaOrchestrator,
          mint,
          tokenAccount.address,
          buyer.publicKey,
          100_000_000_000_000n // 100,000,000
        );
      }
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, mint.toString(), "1");
    });

    it("Prepare Wrapped AVAX as Collateral", async () => {
      const wrapped = await getForeignAssetSolana(
        solanaConnection,
        SOLANA_TOKEN_BRIDGE_ADDRESS.toString(),
        CHAIN_ID_AVAX,
        tryNativeToUint8Array(WAVAX_ADDRESS, CHAIN_ID_AVAX)
      );
      console.log(`WAVAX on Solana: ${wrapped}`);

      // bridge
      const sequences = [];
      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          solanaOrchestrator,
          new web3.PublicKey(wrapped),
          buyer.publicKey
        );

        const avaxReceipt = await transferFromEthNative(
          AVAX_TOKEN_BRIDGE_ADDRESS,
          avaxOrchestrator,
          ethers.utils.parseUnits("1"),
          CHAIN_ID_SOLANA,
          tryNativeToUint8Array(tokenAccount.address.toString(), CHAIN_ID_SOLANA)
        );
        const sequence = parseSequenceFromLogEth(avaxReceipt, AVAX_CORE_BRIDGE_ADDRESS);
        console.log(`transferFromEthNative, sequence=${sequence}`);
        sequences.push(sequence);
      }

      for (const sequence of sequences) {
        const signedVaa = await getSignedVaaFromAvaxTokenBridge(sequence);
        const solanaTx = await postAndRedeemTransferVaa(solanaConnection, solanaOrchestrator, signedVaa);
        console.log(`solanaTx: ${solanaTx}`);
      }

      // in the year 6969, AVAX is worth 4,200,000 USDC
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, wrapped, "4200000");
    });
  });

  describe("Conduct Successful Sale", () => {
    it("Orchestrator Prepares Sale Parameters: Raise", async () => {
      {
        const saleTokenMint = await parameters.saleTokenSolanaMint();
        const custodianSaleTokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          solanaOrchestrator,
          saleTokenMint,
          solanaContributor.custodian,
          true // allowOwnerOffCurve
        );
        console.log(`custodianSaleTokenAccount: ${custodianSaleTokenAccount.address.toString()}`);

        // we want everything denominated in uusd for this test
        // const denominationNativeAddress = "uusd";
        // const denominationDecimals = await (async () => {
        //   const wrapped = await getForeignAssetEth(
        //     AVAX_TOKEN_BRIDGE_ADDRESS,
        //     avaxConnection,
        //     CHAIN_ID_TERRA,
        //     tryNativeToUint8Array(denominationNativeAddress, CHAIN_ID_TERRA)
        //   );

        //   const token = ERC20__factory.connect(wrapped, avaxConnection);
        //   return token.decimals();
        // })();
        const denominationDecimals = 6;

        const amountToSell = "1000000000"; // 1,000,000,000

        const minRaise = "5000000"; //   5,000,000 usdc
        const maxRaise = "20000000"; // 20,000,000 usdc

        parameters.prepareRaise(
          true, // fixed price sale == true
          amountToSell,
          avaxOrchestrator.address,
          avaxOrchestrator.address,
          ethers.utils.parseUnits(minRaise, denominationDecimals).toString(),
          ethers.utils.parseUnits(maxRaise, denominationDecimals).toString(),
          custodianSaleTokenAccount.address,
          KYC_AUTHORITY
        );

        // const raise: Raise = {
        //   isFixedPrice: true,
        //   token: tryNativeToUint8Array(saleTokenMint.toString(), CHAIN_ID_SOLANA),
        //   tokenAmount: balance.toString(),
        //   tokenChain: CHAIN_ID_SOLANA,
        //   minRaise: "1",
        //   maxRaise: "20",
        //   recipient: avaxOrchestrator.address,
        //   refundRecipient: avaxOrchestrator.address,
        //   saleStart,
        //   saleEnd,
        //   unlockTimestamp,
        //   solanaTokenAccount: tryNativeToUint8Array(custodianSaleTokenAccount.address.toString(), CHAIN_ID_SOLANA),
        //   authority: "0x1dF62f291b2E969fB0849d99D9Ce41e2F137006e",
        // };
      }
    });

    it("Orchestrator Creates Sale and Initializes Contributor Program", async () => {
      const raise = parameters.makeRaiseNow(
        30, // delay of when to start sale
        180, // duration of sale
        45 // unlock period after sale ends
      );
      const avaxReceipt = await conductor.createSale(raise, parameters.acceptedTokens);
      console.log(`avaxReceipt: ${avaxReceipt.transactionHash}`);

      // we only care about the last one for the solana contributor
      const [_, sequence] = parseSequencesFromLogEth(avaxReceipt, AVAX_CORE_BRIDGE_ADDRESS);
      console.log(`createSale, sequence=${sequence}`);

      const signedVaa = await (async () => {
        const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
          WORMHOLE_RPCS,
          conductor.chain,
          conductor.emitterAddress(),
          sequence,
          {
            transport: NodeHttpTransport(),
          }
        );
        return Buffer.from(signedVaa);
      })();

      const [payloadId, saleId] = parseIccoHeader(signedVaa);
      expect(payloadId).to.equal(5);

      const saleTokenMint = await parameters.saleTokenSolanaMint();
      const solanaTx = await solanaContributor.initSale(solanaOrchestrator, signedVaa, saleTokenMint);
      console.log(`solanaTx: ${solanaTx}`);

      const saleState = await solanaContributor.getSale(saleId);

      const tokenDecimals = await (async () => {
        const erc20 = await parameters.saleTokenEvm(avaxConnection, AVAX_TOKEN_BRIDGE_ADDRESS);
        return erc20.decimals();
      })();

      console.info("saleState", saleState);

      // verify
      expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
      expect(saleState.saleTokenMint.toString()).to.equal(saleTokenMint.toString());
      expect(saleState.tokenChain).to.equal(raise.tokenChain);
      expect(saleState.tokenDecimals).to.equal(tokenDecimals);
      expect(saleState.times.start.toString()).to.equal(raise.saleStart.toString());
      expect(saleState.times.end.toString()).to.equal(raise.saleEnd.toString());
      expect(saleState.times.unlockAllocation.toString()).to.equal(raise.unlockTimestamp.toString());
      expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(raise.recipient, "hex"));
      expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(raise.authority, "hex"));
      expect(saleState.status).has.key("active");
    });

    it("User Contributes to Sale", async () => {
      // TODO
    });

    it("Orchestrator Attests Contributions", async () => {
      // TODO
    });

    it("Orchestrator Seals Sale", async () => {
      // TODO
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      // TODO
    });

    it("User Claims Contribution Excess From Sale", async () => {
      // TODO
    });

    it("User Claims Allocations From Sale", async () => {
      // TODO
    });
  });

  describe("Conduct Aborted Sale", () => {
    it("Orchestrator Creates Sale and Initializes Contributor Program", async () => {
      // TODO
    });

    it("User Contributes to Sale", async () => {
      // TODO
    });

    it("Orchestrator Aborts Sale", async () => {
      // TODO
    });

    it("User Claims Refund From Sale", async () => {
      // TODO
    });
  });
});
