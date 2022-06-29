import { expect } from "chai";
import { web3, BN } from "@project-serum/anchor";
import { createMint, getMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ethers } from "ethers";
import {
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
  createWrappedOnEth,
  getEmitterAddressSolana,
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
import { KycAuthority } from "../anchor/kyc";
import { getPdaSplBalance, getSplBalance, hexToPublicKey } from "../anchor/utils";

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
      console.log(`createMint (sale token): ${saleTokenMint.toString()}`);

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
      console.log(`mintTo ${tokenAccount.address.toString()}: ${solanaTx}`);

      // attest sale token on Solana and create portal wrapped on Avalanche
      {
        const response = await attestMintFromSolana(solanaConnection, solanaOrchestrator, saleTokenMint);
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`attestMintFromSolana, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxReceipt = await createWrappedOnEth(AVAX_TOKEN_BRIDGE_ADDRESS, avaxOrchestrator, signedVaa);
        console.log(`createWrappedOnEth: ${avaxReceipt.transactionHash}`);
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
        console.log(`redeemOnEth: ${avaxTx.transactionHash}`);
      }

      // save the sale token (to be used for sale trials)
      parameters.setSaleToken(CHAIN_ID_SOLANA, saleTokenMint.toString());
    });

    it("Prepare Native Solana Mint as Collateral", async () => {
      // we're going to pretend this is a stablecoin pegged to USDC price
      const stableMint = await createMint(
        solanaConnection,
        solanaOrchestrator,
        solanaOrchestrator.publicKey,
        solanaOrchestrator.publicKey,
        denominationDecimals // same as USDC decimals on mainnet-beta
      );
      console.log(`createMint (stable): ${stableMint.toString()}`);

      // For each buyer, mint an adequate amount for contributions
      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          buyer,
          stableMint,
          buyer.publicKey
        );

        const solanaTx = await mintTo(
          solanaConnection,
          solanaOrchestrator,
          stableMint,
          tokenAccount.address,
          solanaOrchestrator,
          100_000_000_000_000n // 100,000,000 USDC
        );
        console.log(`mintTo ${tokenAccount.address.toString()}: ${solanaTx}`);

        const balance = await getSplBalance(solanaConnection, stableMint, buyer.publicKey);
        expect(balance.toString()).to.equal("100000000000000");
      }

      // we can just pass in the denominationDecimals, but let's confirm the mint info
      const mintInfo = await getMint(solanaConnection, stableMint);
      expect(mintInfo.decimals).to.equal(denominationDecimals);

      // Add this mint acting as USDC to accepted tokens. Conversion rate of 1
      // means it is priced exactly as USDC, our intended raise denomination
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, stableMint.toString(), "1", denominationDecimals);
    });

    it("Prepare Wrapped AVAX as Collateral", async () => {
      const wavaxMint = new web3.PublicKey(
        await getForeignAssetSolana(
          solanaConnection,
          SOLANA_TOKEN_BRIDGE_ADDRESS.toString(),
          CHAIN_ID_AVAX,
          tryNativeToUint8Array(WAVAX_ADDRESS, CHAIN_ID_AVAX)
        )
      );
      console.log(`wavaxMint: ${wavaxMint.toString()}`);

      // bridge
      const sequences = [];
      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          solanaOrchestrator,
          wavaxMint,
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
        console.log(`postAndRedeemTransferVaa: ${solanaTx}`);
      }

      // need decimals
      const mintInfo = await getMint(solanaConnection, wavaxMint);

      // in the year 6969, AVAX is worth 4,200,000 USDC
      parameters.addAcceptedToken(CHAIN_ID_SOLANA, wavaxMint.toString(), "4200000", mintInfo.decimals);
    });
  });

  describe("Conduct Successful Sale", () => {
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

        const avaxSaleTokenDecimals = await parameters
          .saleTokenEvm(avaxConnection, AVAX_TOKEN_BRIDGE_ADDRESS)
          .then((token) => token.decimals());

        const minRaise = "5000000"; //   5,000,000 usdc
        const maxRaise = "20000000"; // 20,000,000 usdc

        parameters.prepareRaise(
          true, // fixed price sale == true
          ethers.utils.parseUnits(amountToSell, avaxSaleTokenDecimals).toString(),
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
        120, // duration of sale
        60 // unlock period after sale ends
      );
      const avaxReceipt = await conductor.createSale(
        raise,
        acceptedTokens,
        solanaConnection,
        solanaOrchestrator,
        solanaContributor.custodian
      );
      console.log(`createSale: ${avaxReceipt.transactionHash}`);

      // we only care about the last one for the solana contributor
      const sequences = parseSequencesFromLogEth(avaxReceipt, AVAX_CORE_BRIDGE_ADDRESS);
      expect(sequences).has.length(2);

      const [_, sequence] = sequences;
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
      console.log(`initSale: ${solanaTx}`);

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
      console.log(`saleId: ${saleId.toString("hex")}`);
    });

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
        ["12500000"].map((v) => ethers.utils.parseUnits(v, 6).toString()), //          12,500,000 USDC
        ["0.2", "0.4"].map((v) => ethers.utils.parseUnits(v, 8).toString()), //               0.6 AVAX
      ],
      [
        ["2000000", "2200000"].map((v) => ethers.utils.parseUnits(v, 6).toString()), // 4,200,000 USDC
        ["0.9"].map((v) => ethers.utils.parseUnits(v, 8).toString()), //                      0.9 AVAX
      ],
    ];

    it("User Contributes to Sale", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const custodian = solanaContributor.custodian;

      const previousState = await solanaContributor.getSale(saleId);
      const saleStart = previousState.times.start.toNumber() + 10; // adding ten seconds arbitrarily
      await waitUntilSolanaBlock(solanaConnection, saleStart);

      const previousTotals: any = previousState.totals;
      const acceptedMints: web3.PublicKey[] = previousTotals.map((asset) => asset.mint);

      const previousTotalContributions: BN[] = previousTotals.map((asset) => asset.contributions);
      const previousBuyerContributions = await Promise.all(
        buyers.map(async (buyer) => {
          return solanaContributor
            .getBuyer(saleId, buyer.publicKey)
            .then((state) => {
              const amounts: BN[] = (state.contributions as any).map((item) => item.amount);
              return amounts;
            })
            .catch((_) => {
              return acceptedMints.map((_) => new BN("0"));
            });
        })
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

      const startingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(solanaConnection, mint, custodian);
        })
      );

      for (let i = 0; i < buyers.length; ++i) {
        const buyer = buyers.at(i);
        const contributions = buyerContributions.at(i);
        for (let tokenIndex = 0; tokenIndex < contributions.length; ++tokenIndex) {
          for (const amount of contributions.at(tokenIndex).map((value) => new BN(value))) {
            const solanaTx = await solanaContributor.contribute(
              buyer,
              saleId,
              tokenIndex,
              amount,
              await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
            );
            console.log(
              `buyer ${i}: ${buyer.publicKey.toString()}, tokenIndex: ${tokenIndex}, contribute: ${solanaTx}`
            );
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

      const endingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(solanaConnection, mint, custodian);
        })
      );

      // check sale
      const saleState = await solanaContributor.getSale(saleId);
      const assets: any = saleState.totals;

      for (let tokenIndex = 0; tokenIndex < (assets.length as number); ++tokenIndex) {
        const asset = assets.at(tokenIndex);
        expect(asset.allocations.toString()).to.equal("0");
        expect(asset.excessContributions.toString()).to.equal("0");

        const currentTotal: BN = asset.contributions;
        expect(currentTotal.sub(previousTotalContributions.at(tokenIndex)).toString()).to.equal(
          endingBalanceCustodian.at(tokenIndex).sub(startingBalanceCustodian.at(tokenIndex)).toString()
        );
      }

      // check buyers
      for (let i = 0; i < buyers.length; ++i) {
        const previousContributions = previousBuyerContributions.at(i);

        const buyer = buyers.at(i);
        const buyerState = await solanaContributor.getBuyer(saleId, buyer.publicKey);
        const buyerTotals: any = buyerState.contributions;

        const startingBalance = startingBalanceBuyers.at(i);
        const endingBalance = endingBalanceBuyers.at(i);
        const contributions = buyerContributions.at(i);
        for (let tokenIndex = 0; tokenIndex < acceptedMints.length; ++tokenIndex) {
          const expected = contributions
            .at(tokenIndex)
            .map((value) => new BN(value))
            .reduce((prev, curr) => prev.add(curr))
            .toString();

          // check buyer
          {
            expect(startingBalance.at(tokenIndex).sub(endingBalance.at(tokenIndex)).toString()).to.equal(expected);

            const current = buyerTotals.at(tokenIndex);
            expect(current.status).has.key(expected == "0" ? "inactive" : "active");
            expect(current.excess.toString()).to.equal("0");

            const currentAmount: BN = current.amount;
            expect(currentAmount.sub(previousContributions.at(tokenIndex)).toString()).to.equal(expected);
          }
        }
      }
    });

    it("Orchestrator Attests and Collects Contributions", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }
      const previousState = await solanaContributor.getSale(saleId);
      const saleEnd = previousState.times.end.toNumber() + 10; // adding two seconds arbitrarily
      await waitUntilSolanaBlock(solanaConnection, saleEnd);

      const solanaResponse = await solanaContributor
        .attestContributions(solanaOrchestrator, saleId)
        .then((tx) => solanaConnection.getTransaction(tx));
      const sequence = parseSequenceFromLogSolana(solanaResponse);
      console.log(`attestContributions, sequence=${sequence}`);

      const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
        WORMHOLE_RPCS,
        CHAIN_ID_SOLANA,
        await getEmitterAddressSolana(solanaContributor.program.programId.toString()),
        sequence,
        {
          transport: NodeHttpTransport(),
        }
      );

      const avaxReceipt = await conductor.collectContribution(signedVaa);
      console.log(`collectContribution: ${avaxReceipt.transactionHash}`);
    });

    it("Orchestrator Seals Sale", async () => {
      const saleId = currentSaleId;

      const avaxReceipt = await conductor.sealSale(ethers.BigNumber.from(saleId));
      console.log(`sealSale: ${avaxReceipt.transactionHash}`);
      const sequences = parseSequencesFromLogEth(avaxReceipt, AVAX_CORE_BRIDGE_ADDRESS);

      // first two are token bridge transfers
      // second two are saleSealed vaas (second one of which is what we need)
      expect(sequences).has.length(4);

      for (let i = 0; i < 2; ++i) {
        const signedVaa = await getSignedVaaFromAvaxTokenBridge(sequences.shift());
        const solanaTx = await postAndRedeemTransferVaa(solanaConnection, solanaOrchestrator, signedVaa);
        console.log(`postAndRedeemTransferVaa: ${solanaTx}`);
      }

      const [_, sequence] = sequences;
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

      const [payloadId, checkSaleId] = parseIccoHeader(signedVaa);
      expect(payloadId).to.equal(3);
      expect(checkSaleId).to.deep.equal(saleId);

      const solanaTx = await solanaContributor.sealSale(solanaOrchestrator, signedVaa);
      console.log(`sealSale: ${solanaTx}`);
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
