import { expect } from "chai";
import { web3 } from "@project-serum/anchor";
import { createMint, getMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ethers } from "ethers";
import {
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
  createWrappedOnEth,
  getForeignAssetSolana,
  getOriginalAssetSol,
  getSignedVAAWithRetry,
  parseSequenceFromLogEth,
  parseSequenceFromLogSolana,
  parseSequencesFromLogEth,
  postVaaSolanaWithRetry,
  redeemOnEth,
  setDefaultWasm,
  transferFromEthNative,
  tryNativeToHexString,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
  uint8ArrayToHex,
} from "@certusone/wormhole-sdk";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

import { IccoConductor as EvmConductor } from "../evm/conductor";
import { IccoContributor as SolanaContributor } from "../anchor/contributor";

import {
  AVAX_CORE_BRIDGE_ADDRESS,
  AVAX_TOKEN_BRIDGE_ADDRESS,
  CONDUCTOR_NATIVE_ADDRESS,
  CONDUCTOR_NATIVE_CHAIN,
  KYC_AUTHORITY,
  KYC_PRIVATE,
  REPO_PATH,
  SOLANA_CONTRIBUTOR_ADDRESS,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SOLANA_TOKEN_BRIDGE_ADDRESS,
  WAVAX_ADDRESS,
  WORMHOLE_RPCS,
} from "./consts";
import { connectToContributorProgram } from "./solana";
import { Purse } from "./purse";
import {
  attestMintFromSolana,
  getSignedVaaFromAvaxTokenBridge,
  getSignedVaaFromSolanaTokenBridge,
  postAndRedeemTransferVaa,
  transferFromSolanaToEvm,
  waitUntilSolanaBlock,
} from "./utils";
import { parseIccoHeader, SaleParameters } from "../utils";
import { BN } from "bn.js";
import { KycAuthority } from "../anchor/kyc";
import { getSplBalance, hexToPublicKey } from "../anchor/utils";

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
    console.log(`buyer ${i}: ${buyers.at(i).publicKey.toString()}`);
  }

  // avax conductor
  const conductor = new EvmConductor(
    CONDUCTOR_NATIVE_ADDRESS,
    CONDUCTOR_NATIVE_CHAIN,
    avaxOrchestrator,
    AVAX_CORE_BRIDGE_ADDRESS,
    AVAX_TOKEN_BRIDGE_ADDRESS
  );

  // solana contributor consider renaming to solanaDevnet in testnet.json?
  const solanaContributor = new SolanaContributor(
    connectToContributorProgram(purse.solana.endpoint, solanaOrchestrator, SOLANA_CONTRIBUTOR_ADDRESS),
    SOLANA_CORE_BRIDGE_ADDRESS,
    SOLANA_TOKEN_BRIDGE_ADDRESS,
    postVaaSolanaWithRetry
  );

  // kyc for signing contributions
  const kyc = new KycAuthority(
    KYC_PRIVATE,
    tryNativeToHexString(CONDUCTOR_NATIVE_ADDRESS, CONDUCTOR_NATIVE_CHAIN),
    solanaContributor
  );

  // warehouse parameters
  const denominationDecimals = 6; // same as USDC
  const parameters = new SaleParameters(CONDUCTOR_NATIVE_CHAIN, denominationDecimals);

  before("Check Balances", async () => {
    // need at least 2.5 AVAX to proceed with the test
    const avaxBalance = await avaxConnection.getBalance(avaxOrchestrator.address);
    expect(avaxBalance.gte(ethers.utils.parseUnits("2.5"))).to.be.true;

    // need at least 1 SOL to proceed with the test
    const solBalance = await solanaConnection.getBalance(solanaOrchestrator.publicKey);
    expect(solBalance).gte(1);

    for (const buyer of buyers) {
      const solBalance = await solanaConnection.getBalance(buyer.publicKey);
      expect(solBalance).gte(1);
    }
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

      const solanaTx = await mintTo(
        solanaConnection,
        solanaOrchestrator,
        saleTokenMint,
        tokenAccount.address,
        solanaOrchestrator,
        10_000_000_000_000_000_000n // 10,000,000
      );
      //await solanaConnection.confirmTransaction(solanaTx, "confirmed");

      // attest sale token on Solana and create portal wrapped on Avalanche
      {
        const response = await attestMintFromSolana(solanaConnection, solanaOrchestrator, saleTokenMint);
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`attestMintFromSolana, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxTx = await createWrappedOnEth(AVAX_TOKEN_BRIDGE_ADDRESS, avaxOrchestrator, signedVaa);
        console.log(`avaxTx: ${avaxTx.transactionHash}`);
      }

      // transfer sale tokens from Solana to Avalanche
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

      // save the sale token (to be used for sale trials)
      parameters.setSaleToken(CHAIN_ID_SOLANA, saleTokenMint.toString());
    });

    it("Prepare Native Solana Mint as Collateral", async () => {
      // we're going to pretend this is a stablecoin pegged to USDC price
      const mint = await createMint(
        solanaConnection,
        solanaOrchestrator,
        solanaOrchestrator.publicKey,
        solanaOrchestrator.publicKey,
        denominationDecimals // same as USDC decimals on mainnet-beta
      );
      console.log(`createMint: ${mint.toString()}`);

      // For each buyer, mint an adequate amount for contributions
      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(solanaConnection, buyer, mint, buyer.publicKey);

        const solanaTx = await mintTo(
          solanaConnection,
          solanaOrchestrator,
          mint,
          tokenAccount.address,
          solanaOrchestrator,
          100_000_000_000_000n // 100,000,000 USDC
        );

        const balance = await getSplBalance(solanaConnection, mint, buyer.publicKey);
        console.log(
          `mintTo: ${tokenAccount.address.toString()} belonging to ${buyer.publicKey.toString()}, balance: ${balance.toString()}`
        );
        expect(balance.toString()).to.equal("100000000000000");
      }

      // we can just pass in the denominationDecimals, but let's confirm the mint info
      const mintInfo = await getMint(solanaConnection, mint);
      expect(mintInfo.decimals).to.equal(denominationDecimals);

      // Add this mint acting as USDC to accepted tokens. Conversion rate of 1
      // means it is priced exactly as USDC, our intended raise denomination
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, mint.toString(), "1", denominationDecimals);
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
          ethers.utils.parseUnits("1"), // 1 AVAX per buyer
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

      // need decimals
      const mintInfo = await getMint(solanaConnection, new web3.PublicKey(wrapped));

      // in the year 6969, AVAX is worth 4,200,000 USDC
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, wrapped, "4200000", mintInfo.decimals);
    });
  });

  describe("Conduct Successful Sale", () => {
    // In total, we are going to contribute:
    //
    //   1.5 AVAX:        1.5 * 4,200,000 =  6,300,000
    //   16,700,000 USDC: 16,700,000 * 1  = 16,700,000
    //                                    ------------
    //                               Total: 25,000,000
    //
    //                           Max Raise: 20,000,000
    //                              Excess:  5,000,000

    const buyerContributions = [
      [
        ["12500000"], //          12,500,000 USDC
        ["0.2", "0.4"], //               0.6 AVAX
      ],
      [
        ["2000000", "2200000"], // 4,200,000 USDC
        ["0.9"], //                      0.9 AVAX
      ],
    ];

    // we need this sale id for the test
    let currentSaleId: Buffer;

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
      }
    });

    it("Orchestrator Creates Sale and Initializes Contributor Program", async () => {
      const acceptedTokens = parameters.acceptedTokens;

      const raise = parameters.makeRaiseNow(
        60, // delay of when to start sale
        180, // duration of sale
        60 // unlock period after sale ends
      );
      const avaxReceipt = await conductor.createSale(
        raise,
        acceptedTokens,
        solanaConnection,
        solanaOrchestrator,
        solanaContributor.custodian
      );
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

      // verify
      expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
      expect(saleState.saleTokenMint.toString()).to.equal(saleTokenMint.toString());
      expect(saleState.tokenChain).to.equal(raise.tokenChain);
      expect(saleState.tokenDecimals).to.equal(tokenDecimals);
      expect(saleState.times.start.toString()).to.equal(raise.saleStart.toString());
      expect(saleState.times.end.toString()).to.equal(raise.saleEnd.toString());
      expect(saleState.times.unlockAllocation.toString()).to.equal(raise.unlockTimestamp.toString());
      expect(Uint8Array.from(saleState.recipient)).to.deep.equal(
        tryNativeToUint8Array(raise.recipient, CONDUCTOR_NATIVE_CHAIN)
      );
      expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(ethers.utils.arrayify(raise.authority));
      expect(saleState.status).has.key("active");

      const totals: any = saleState.totals;
      const numExpected = acceptedTokens.length;
      expect(totals.length).to.equal(numExpected);

      for (let tokenIndex = 0; tokenIndex < numExpected; ++tokenIndex) {
        const total = totals.at(tokenIndex);
        const token = acceptedTokens.at(tokenIndex);

        expect(total.tokenIndex).to.equal(tokenIndex);
        expect(total.mint.toString()).to.equal(
          tryUint8ArrayToNative(ethers.utils.arrayify(token.tokenAddress), CHAIN_ID_SOLANA)
        );
        expect(total.contributions.toString()).to.equal("0");
        expect(total.allocations.toString()).to.equal("0");
        expect(total.excessContributions.toString()).to.equal("0");
        expect(total.status).has.key("active");
      }

      // save saleId for later use
      currentSaleId = saleId;
    });

    it("User Contributes to Sale", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const saleStart = ethers.BigNumber.from(parameters.raise.saleStart).toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleStart);

      const acceptedTokens = parameters.acceptedTokens;
      const acceptedMints = acceptedTokens.map((token) =>
        hexToPublicKey(uint8ArrayToHex(ethers.utils.arrayify(token.tokenAddress)))
      );

      const startingBalanceBuyers = await Promise.all(
        buyers.map(async (buyer) => {
          return Promise.all(
            acceptedMints.map(async (mint) => {
              return getSplBalance(solanaConnection, mint, buyer.publicKey);
            })
          );
        })
      );

      for (let i = 0; i < buyers.length; ++i) {
        const buyer = buyers.at(i);
        const contributions = buyerContributions.at(i);
        for (let tokenIndex = 0; tokenIndex < contributions.length; ++tokenIndex) {
          if (tokenIndex == 1) {
            console.log(`force skip tokenIndex ${tokenIndex}`);
            continue;
          }
          const mint = acceptedMints.at(tokenIndex);
          for (const decimalizedAmount of contributions.at(tokenIndex)) {
            const mintInfo = await getMint(solanaConnection, mint);
            const amount = new BN(ethers.utils.parseUnits(decimalizedAmount, mintInfo.decimals).toString());
            const solanaTx = await solanaContributor.contribute(
              buyer,
              saleId,
              tokenIndex,
              amount,
              await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
            );
            console.log(`buyer ${i}: ${buyer.publicKey.toString()}, tokenIndex: ${tokenIndex}, solanaTx: ${solanaTx}`);
          }
        }
      }

      const endingBalanceBuyers = await Promise.all(
        buyers.map(async (buyer) => {
          return Promise.all(
            acceptedMints.map(async (mint) => {
              return getSplBalance(solanaConnection, mint, buyer.publicKey);
            })
          );
        })
      );

      for (let i = 0; i < buyers.length; ++i) {
        for (let tokenIndex = 0; tokenIndex < acceptedMints.length; ++tokenIndex) {
          if (tokenIndex == 1) {
            console.log(`force skip tokenIndex ${tokenIndex}`);
            continue;
          }
          // check buyer
          {
            const start = startingBalanceBuyers.at(i).at(tokenIndex);
            const end = endingBalanceBuyers.at(i).at(tokenIndex);
            const expected = buyerContributions
              .at(i)
              .at(tokenIndex)
              .map((value) => new BN(value))
              .reduce((prev, curr) => prev.add(curr));
            console.log("buyer", i, "tokenIndex", tokenIndex, start.toString(), end.toString(), expected.toString());
            expect(start.sub(end).toString()).to.equal(expected.toString());
          }
        }
      }
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
