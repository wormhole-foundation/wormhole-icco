import { expect } from "chai";
import { web3, BN } from "@project-serum/anchor";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { ethers } from "ethers";
import {
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
  createWrappedOnEth,
  getEmitterAddressSolana,
  getForeignAssetSolana,
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
import { parseIccoHeader, unitsToUint, SaleParameters } from "../utils";
import { KycAuthority } from "../anchor/kyc";
import { getPdaSplBalance, getSplBalance } from "../anchor/utils";
import { signNewAuthorityOnEth } from "./kyc";
import { updateSaleAuthorityOnEth } from "../icco/updateSaleAuthority";

setDefaultWasm("node");

describe("Testnet ICCO Sales", () => {
  // warehouse wallets from various chains
  //
  // JSON file resembles the following format:
  //   {
  //     "avax": {
  //       "rpc": "https://api.avax-test.network/ext/bc/C/rpc",
  //       "wallets": [
  //         "00000000000000000000000000000000000000000000000000000000deadbeef",
  //         "00000000000000000000000000000000000000000000000000000000deadbeef",
  //         "00000000000000000000000000000000000000000000000000000000deadbeef"
  //       ]
  //     },
  //     "ethereum": {
  //       "rpc": "https://your-ethereum-rpc-here",
  //       "wallets": [
  //         "00000000000000000000000000000000000000000000000000000000deadbeef",
  //         "00000000000000000000000000000000000000000000000000000000deadbeef",
  //         "00000000000000000000000000000000000000000000000000000000deadbeef"
  //       ]
  //     },
  //     "solana": {
  //       "rpc": "https://api.devnet.solana.com",
  //       "wallets": [
  //         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42, 0, 69],
  //         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42, 0, 69],
  //         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42, 0, 69],
  //       ]
  //     }
  //   }
  if (!process.env.TESTNET_WALLETS) {
    throw Error("TESTNET_WALLETS not found in environment");
  }
  const purse = new Purse(process.env.TESTNET_WALLETS);

  // providers
  const avaxConnection = purse.avax.provider;
  const solanaConnection = purse.solana.provider;

  // use deployer key so we can update kyc authority on Conductor
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw Error("DEPLOYER_PRIVATE_KEY not found in environment");
  }
  const deployer = new ethers.Wallet(
    "0x" + process.env.DEPLOYER_PRIVATE_KEY,
    avaxConnection
  );

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
    connectToContributorProgram(
      solanaConnection,
      solanaOrchestrator,
      SOLANA_CONTRIBUTOR_ADDRESS
    ),
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
  const parameters = new SaleParameters(
    CONDUCTOR_NATIVE_CHAIN,
    denominationDecimals
  );

  before("Check Balances", async () => {
    // need at least 2.5 AVAX to proceed with the test
    const avaxBalance = await avaxConnection.getBalance(
      avaxOrchestrator.address
    );
    expect(avaxBalance.gte(ethers.utils.parseUnits("2.5"))).to.be.true;

    // need at least 1 SOL to proceed with the test
    const solBalance = await solanaConnection.getBalance(
      solanaOrchestrator.publicKey
    );
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
        const [solanaTx, response] = await attestMintFromSolana(
          solanaConnection,
          solanaOrchestrator,
          saleTokenMint
        );
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`attestMintFromSolana: ${solanaTx}, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxReceipt = await createWrappedOnEth(
          AVAX_TOKEN_BRIDGE_ADDRESS,
          avaxOrchestrator,
          signedVaa
        );
        console.log(`createWrappedOnEth: ${avaxReceipt.transactionHash}`);
      }

      // transfer sale tokens from Solana to Avalanche
      {
        const [solanaTx, response] = await transferFromSolanaToEvm(
          solanaConnection,
          solanaOrchestrator,
          saleTokenMint,
          2_000_000_000_000_000_000n, // 10% of tokens per sale
          CHAIN_ID_AVAX,
          avaxOrchestrator.address
        );
        const sequence = parseSequenceFromLogSolana(response);
        console.log(
          `transferFromSolanaToEvm: ${solanaTx}, sequence=${sequence}`
        );

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxTx = await redeemOnEth(
          AVAX_TOKEN_BRIDGE_ADDRESS,
          avaxOrchestrator,
          signedVaa
        );
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

        const balance = await getSplBalance(
          solanaConnection,
          stableMint,
          buyer.publicKey
        );
        expect(balance.toString()).to.equal("100000000000000");
      }

      // we can just pass in the denominationDecimals, but let's confirm the mint info
      const mintInfo = await getMint(solanaConnection, stableMint);
      expect(mintInfo.decimals).to.equal(denominationDecimals);

      // Add this mint acting as USDC to accepted tokens. Conversion rate of 1
      // means it is priced exactly as USDC, our intended raise denomination
      parameters.addAcceptedToken(
        CHAIN_ID_SOLANA,
        stableMint.toString(),
        "1",
        denominationDecimals
      );
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
          tryNativeToUint8Array(
            tokenAccount.address.toString(),
            CHAIN_ID_SOLANA
          )
        );
        const sequence = parseSequenceFromLogEth(
          avaxReceipt,
          AVAX_CORE_BRIDGE_ADDRESS
        );
        console.log(
          `transferFromEthNative: ${avaxReceipt.transactionHash}, sequence=${sequence}`
        );
        sequences.push(sequence);
      }

      for (const sequence of sequences) {
        const signedVaa = await getSignedVaaFromAvaxTokenBridge(sequence);
        const [solanaTx, _] = await postAndRedeemTransferVaa(
          solanaConnection,
          solanaOrchestrator,
          signedVaa
        );
        console.log(`postAndRedeemTransferVaa: ${solanaTx}`);
      }

      // need decimals
      const mintInfo = await getMint(solanaConnection, wavaxMint);

      // in the year 6969, AVAX is worth 4,200,000 USDC
      parameters.addAcceptedToken(
        CHAIN_ID_SOLANA,
        wavaxMint.toString(),
        "4200000",
        mintInfo.decimals
      );
    });
  });

  describe("Conduct Aborted Sale", () => {
    // we need this sale id for the test
    let currentSaleId: Buffer;

    it("Orchestrator Prepares Sale Parameters: Raise", async () => {
      {
        const saleTokenMint = await parameters.saleTokenSolanaMint();
        const custodianSaleTokenAccount =
          await getOrCreateAssociatedTokenAccount(
            solanaConnection,
            solanaOrchestrator,
            saleTokenMint,
            solanaContributor.custodian,
            true // allowOwnerOffCurve
          );
        console.log(
          `custodianSaleTokenAccount: ${custodianSaleTokenAccount.address.toString()}`
        );

        const amountToSell = "1000000000"; // 1,000,000,000

        const avaxSaleTokenDecimals = await parameters
          .saleTokenEvm(avaxConnection, AVAX_TOKEN_BRIDGE_ADDRESS)
          .then((token) => token.decimals());

        const minRaise = "5000000"; //   5,000,000 usdc
        const maxRaise = "20000000"; // 20,000,000 usdc

        parameters.prepareRaise(
          true, // fixed price sale == true
          ethers.utils
            .parseUnits(amountToSell, avaxSaleTokenDecimals)
            .toString(),
          avaxOrchestrator.address,
          avaxOrchestrator.address,
          ethers.utils.parseUnits(minRaise, denominationDecimals).toString(),
          ethers.utils.parseUnits(maxRaise, denominationDecimals).toString(),
          custodianSaleTokenAccount.address,
          "0x00000000000000000000000000000000deadbeef"
        );
      }
    });

    it("Orchestrator Creates Sale and Initializes Solana Contributor Program", async () => {
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

      // we only care about the last one for the solana contributor
      const sequences = parseSequencesFromLogEth(
        avaxReceipt,
        AVAX_CORE_BRIDGE_ADDRESS
      );
      console.log(
        `createSale: ${avaxReceipt.transactionHash}, sequences: ${sequences}`
      );
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
      const solanaTx = await solanaContributor.initSale(
        solanaOrchestrator,
        signedVaa
      );
      console.log(`initSale: ${solanaTx}`);

      const saleState = await solanaContributor.getSale(saleId);

      const tokenDecimals = await (async () => {
        const erc20 = await parameters.saleTokenEvm(
          avaxConnection,
          AVAX_TOKEN_BRIDGE_ADDRESS
        );
        return erc20.decimals();
      })();

      // verify
      expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
      expect(saleState.saleTokenMint.toString()).to.equal(
        saleTokenMint.toString()
      );
      expect(saleState.tokenChain).to.equal(raise.tokenChain);
      expect(saleState.tokenDecimals).to.equal(tokenDecimals);
      expect(saleState.times.start.toString()).to.equal(
        raise.saleStart.toString()
      );
      expect(saleState.times.end.toString()).to.equal(raise.saleEnd.toString());
      expect(saleState.times.unlockAllocation.toString()).to.equal(
        raise.unlockTimestamp.toString()
      );
      expect(Uint8Array.from(saleState.recipient)).to.deep.equal(
        tryNativeToUint8Array(raise.recipient, CONDUCTOR_NATIVE_CHAIN)
      );
      expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(
        ethers.utils.arrayify(raise.authority)
      );
      expect(saleState.status).has.key("active");

      const totals = saleState.totals as any[];
      const numExpected = acceptedTokens.length;
      expect(totals.length).to.equal(numExpected);

      for (let tokenIndex = 0; tokenIndex < numExpected; ++tokenIndex) {
        const total = totals.at(tokenIndex);
        const token = acceptedTokens.at(tokenIndex);

        expect(total.tokenIndex).to.equal(tokenIndex);
        expect(total.mint.toString()).to.equal(
          tryUint8ArrayToNative(
            ethers.utils.arrayify(token.tokenAddress),
            CHAIN_ID_SOLANA
          )
        );
        expect(total.contributions.toString()).to.equal("0");
        expect(total.allocations.toString()).to.equal("0");
        expect(total.excessContributions.toString()).to.equal("0");
        expect(total.assetStatus).has.key("active");
      }

      // save saleId for later use
      currentSaleId = saleId;
      console.log(`saleId: ${saleId.toString("hex")}`);
    });

    it("Conductor Owner Changes KYC Authority for Sale", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const ethSaleId = ethers.BigNumber.from(saleId);
      const signature = signNewAuthorityOnEth(
        tryNativeToHexString(CONDUCTOR_NATIVE_ADDRESS, CONDUCTOR_NATIVE_CHAIN),
        ethSaleId,
        KYC_PRIVATE
      );

      const avaxReceipt = await updateSaleAuthorityOnEth(
        CONDUCTOR_NATIVE_ADDRESS,
        deployer,
        ethSaleId,
        KYC_AUTHORITY,
        signature
      );

      // we only care about the last one for the solana contributor
      const sequences = parseSequencesFromLogEth(
        avaxReceipt,
        AVAX_CORE_BRIDGE_ADDRESS
      );
      console.log(
        `updateSaleAuthorityOnEth: ${avaxReceipt.transactionHash}, sequences: ${sequences}`
      );
      expect(sequences).has.length(1);

      const sequence = sequences.pop()!;
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

      const [payloadId, _] = parseIccoHeader(signedVaa);
      expect(payloadId).to.equal(6);

      const solanaTx = await solanaContributor.updateKycAuthority(
        solanaOrchestrator,
        signedVaa
      );
      console.log(`updateKycAuthority: ${solanaTx}`);

      {
        const saleState = await solanaContributor.getSale(saleId);
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(
          ethers.utils.arrayify(KYC_AUTHORITY)
        );
      }
    });

    // In total, we are going to contribute:
    //
    //   0.15 AVAX:      0.15 * 4,200,000 =   630,000
    //   1,670,000 USDC:    1,670,000 * 1 = 1,670,000
    //                                    ------------
    //                               Total: 2,300,000

    const buyerContributions = [
      [
        ["270000"].map((v) => unitsToUint(v, 6)), // 270,000 USDC
        ["0.02"].map((v) => unitsToUint(v, 8)), //      0.02 AVAX
      ],
      [
        ["420000"].map((v) => unitsToUint(v, 6)), // 420,000 USDC
        ["0.03"].map((v) => unitsToUint(v, 8)), //      0.03 AVAX
      ],
    ];

    it("Users Contribute to Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const custodian = solanaContributor.custodian;

      const previousState = await solanaContributor.getSale(saleId);
      const saleStart = previousState.times.start.toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleStart);

      const previousTotals = previousState.totals as any[];
      const acceptedMints: web3.PublicKey[] = previousTotals.map(
        (asset) => asset.mint
      );

      const previousTotalContributions: BN[] = previousTotals.map(
        (asset) => asset.contributions
      );
      const previousBuyerContributions = await Promise.all(
        buyers.map(async (buyer) => {
          return solanaContributor
            .getBuyer(saleId, buyer.publicKey)
            .then((state) => {
              const amounts: BN[] = (state.contributions as any).map(
                (item) => item.amount
              );
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
        for (
          let tokenIndex = 0;
          tokenIndex < contributions.length;
          ++tokenIndex
        ) {
          for (const amount of contributions.at(tokenIndex)) {
            const solanaTx = await solanaContributor.contribute(
              buyer,
              saleId,
              tokenIndex,
              amount,
              await kyc.signContribution(
                saleId,
                tokenIndex,
                amount,
                buyer.publicKey
              )
            );
            console.log(
              `buyer ${i}, tokenIndex: ${tokenIndex}, contribute: ${solanaTx}`
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
      const assets = saleState.totals as any[];

      for (
        let tokenIndex = 0;
        tokenIndex < (assets.length as number);
        ++tokenIndex
      ) {
        const asset = assets.at(tokenIndex);
        expect(asset.allocations.toString()).to.equal("0");
        expect(asset.excessContributions.toString()).to.equal("0");

        const currentTotal: BN = asset.contributions;
        expect(
          currentTotal.sub(previousTotalContributions.at(tokenIndex)).toString()
        ).to.equal(
          endingBalanceCustodian
            .at(tokenIndex)
            .sub(startingBalanceCustodian.at(tokenIndex))
            .toString()
        );
      }

      // check buyers
      for (let i = 0; i < buyers.length; ++i) {
        const previousContributions = previousBuyerContributions.at(i);

        const buyer = buyers.at(i);
        const buyerState = await solanaContributor.getBuyer(
          saleId,
          buyer.publicKey
        );
        const buyerTotals = buyerState.contributions as any[];

        const startingBalance = startingBalanceBuyers.at(i);
        const endingBalance = endingBalanceBuyers.at(i);
        const contributions = buyerContributions.at(i);
        for (
          let tokenIndex = 0;
          tokenIndex < acceptedMints.length;
          ++tokenIndex
        ) {
          const expected = contributions
            .at(tokenIndex)
            .reduce((prev, curr) => prev.add(curr))
            .toString();

          // check buyer
          {
            expect(
              startingBalance
                .at(tokenIndex)
                .sub(endingBalance.at(tokenIndex))
                .toString()
            ).to.equal(expected);

            const current = buyerTotals.at(tokenIndex);
            expect(current.status).has.key(
              expected == "0" ? "inactive" : "active"
            );
            expect(current.excess.toString()).to.equal("0");

            const currentAmount: BN = current.amount;
            expect(
              currentAmount.sub(previousContributions.at(tokenIndex)).toString()
            ).to.equal(expected);
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
      const saleEnd = previousState.times.end.toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleEnd);

      const solanaResponse = await solanaContributor
        .attestContributions(solanaOrchestrator, saleId)
        .then((tx) => solanaConnection.getTransaction(tx));
      const sequence = parseSequenceFromLogSolana(solanaResponse);
      console.log(`attestContributions, sequence=${sequence}`);

      const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
        WORMHOLE_RPCS,
        CHAIN_ID_SOLANA,
        await getEmitterAddressSolana(
          solanaContributor.program.programId.toString()
        ),
        sequence,
        {
          transport: NodeHttpTransport(),
        }
      );

      const avaxReceipt = await conductor.collectContribution(signedVaa);
      console.log(`collectContribution: ${avaxReceipt.transactionHash}`);
    });

    it("Orchestrator Attempts to Seal Sale on Conductor and Aborts Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const avaxReceipt = await conductor.sealSale(
        ethers.BigNumber.from(saleId)
      );
      const sequences = parseSequencesFromLogEth(
        avaxReceipt,
        AVAX_CORE_BRIDGE_ADDRESS
      );
      console.log(
        `sealSale: ${avaxReceipt.transactionHash}, sequences: ${sequences}`
      );

      // first two are token bridge transfers
      // second two are saleSealed vaas (second one of which is what we need)
      expect(sequences).has.length(1);

      const sequence = sequences.pop()!;
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
      expect(payloadId).to.equal(4);
      expect(checkSaleId).to.deep.equal(saleId);

      const solanaTx = await solanaContributor.abortSale(
        solanaOrchestrator,
        signedVaa
      );
      console.log(`abortSale: ${solanaTx}`);

      // check sale status
      {
        const sale = await solanaContributor.getSale(saleId);
        expect(sale.status).has.key("aborted");
      }
    });

    it("Users Claim Refund From Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const saleState = await solanaContributor.getSale(saleId);
      const assetTotals = saleState.totals as any[];
      const acceptedMints: web3.PublicKey[] = assetTotals.map(
        (asset) => asset.mint
      );

      for (const buyer of buyers) {
        const startingBalances = await Promise.all(
          acceptedMints.map(async (mint) => {
            return getSplBalance(solanaConnection, mint, buyer.publicKey);
          })
        );

        const tx = await solanaContributor.claimRefunds(buyer, saleId);

        const endingBalances = await Promise.all(
          acceptedMints.map(async (mint) => {
            return getSplBalance(solanaConnection, mint, buyer.publicKey);
          })
        );

        const buyerState = await solanaContributor.getBuyer(
          saleId,
          buyer.publicKey
        );
        const buyerTotals = buyerState.contributions as any[];

        for (let i = 0; i < acceptedMints.length; ++i) {
          const buyerTotal = buyerTotals.at(i);
          expect(buyerTotal.status).has.key("refundClaimed");

          const expected = buyerTotal.amount;
          expect(buyerTotal.excess.toString()).to.equal(expected.toString());
          expect(
            endingBalances.at(i).sub(startingBalances.at(i)).toString()
          ).to.equal(expected.toString());
        }
      }
    });
  });

  describe("Conduct Successful Sale", () => {
    // we need this sale id for the test
    let currentSaleId: Buffer;

    it("Orchestrator Prepares Sale Parameters: Raise", async () => {
      {
        const saleTokenMint = await parameters.saleTokenSolanaMint();
        const custodianSaleTokenAccount =
          await getOrCreateAssociatedTokenAccount(
            solanaConnection,
            solanaOrchestrator,
            saleTokenMint,
            solanaContributor.custodian,
            true // allowOwnerOffCurve
          );
        console.log(
          `custodianSaleTokenAccount: ${custodianSaleTokenAccount.address.toString()}`
        );

        const amountToSell = "1000000000"; // 1,000,000,000

        const avaxSaleTokenDecimals = await parameters
          .saleTokenEvm(avaxConnection, AVAX_TOKEN_BRIDGE_ADDRESS)
          .then((token) => token.decimals());

        const minRaise = "5000000"; //   5,000,000 usdc
        const maxRaise = "20000000"; // 20,000,000 usdc

        parameters.prepareRaise(
          true, // fixed price sale == true
          ethers.utils
            .parseUnits(amountToSell, avaxSaleTokenDecimals)
            .toString(),
          avaxOrchestrator.address,
          avaxOrchestrator.address,
          ethers.utils.parseUnits(minRaise, denominationDecimals).toString(),
          ethers.utils.parseUnits(maxRaise, denominationDecimals).toString(),
          custodianSaleTokenAccount.address,
          KYC_AUTHORITY
        );
      }
    });

    it("Orchestrator Creates Sale and Initializes Solana Contributor Program", async () => {
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
      const sequences = parseSequencesFromLogEth(
        avaxReceipt,
        AVAX_CORE_BRIDGE_ADDRESS
      );
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
      const solanaTx = await solanaContributor.initSale(
        solanaOrchestrator,
        signedVaa
      );
      console.log(`initSale: ${solanaTx}`);

      const saleState = await solanaContributor.getSale(saleId);

      const tokenDecimals = await (async () => {
        const erc20 = await parameters.saleTokenEvm(
          avaxConnection,
          AVAX_TOKEN_BRIDGE_ADDRESS
        );
        return erc20.decimals();
      })();

      // verify
      expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
      expect(saleState.saleTokenMint.toString()).to.equal(
        saleTokenMint.toString()
      );
      expect(saleState.tokenChain).to.equal(raise.tokenChain);
      expect(saleState.tokenDecimals).to.equal(tokenDecimals);
      expect(saleState.times.start.toString()).to.equal(
        raise.saleStart.toString()
      );
      expect(saleState.times.end.toString()).to.equal(raise.saleEnd.toString());
      expect(saleState.times.unlockAllocation.toString()).to.equal(
        raise.unlockTimestamp.toString()
      );
      expect(Uint8Array.from(saleState.recipient)).to.deep.equal(
        tryNativeToUint8Array(raise.recipient, CONDUCTOR_NATIVE_CHAIN)
      );
      expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(
        ethers.utils.arrayify(raise.authority)
      );
      expect(saleState.status).has.key("active");

      const totals = saleState.totals as any[];
      const numExpected = acceptedTokens.length;
      expect(totals.length).to.equal(numExpected);

      for (let tokenIndex = 0; tokenIndex < numExpected; ++tokenIndex) {
        const total = totals.at(tokenIndex);
        const token = acceptedTokens.at(tokenIndex);

        expect(total.tokenIndex).to.equal(tokenIndex);
        expect(total.mint.toString()).to.equal(
          tryUint8ArrayToNative(
            ethers.utils.arrayify(token.tokenAddress),
            CHAIN_ID_SOLANA
          )
        );
        expect(total.contributions.toString()).to.equal("0");
        expect(total.allocations.toString()).to.equal("0");
        expect(total.excessContributions.toString()).to.equal("0");
        expect(total.assetStatus).has.key("active");
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
    //                               Total: 23,000,000
    //
    //                           Max Raise: 20,000,000
    //                              Excess:  3,000,000

    const buyerContributions = [
      [
        ["12500000"].map((v) => unitsToUint(v, 6)), // 12,500,000 USDC
        ["0.6"].map((v) => unitsToUint(v, 8)), //             0.6 AVAX
      ],
      [
        ["4200000"].map((v) => unitsToUint(v, 6)), //    4,200,000 USDC
        ["0.9"].map((v) => unitsToUint(v, 8)), //              0.9 AVAX
      ],
    ];

    it("Users Contribute to Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const custodian = solanaContributor.custodian;

      const previousState = await solanaContributor.getSale(saleId);
      const saleStart = previousState.times.start.toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleStart);

      const previousTotals = previousState.totals as any[];
      const acceptedMints: web3.PublicKey[] = previousTotals.map(
        (asset) => asset.mint
      );

      const previousTotalContributions: BN[] = previousTotals.map(
        (asset) => asset.contributions
      );
      const previousBuyerContributions = await Promise.all(
        buyers.map(async (buyer) => {
          return solanaContributor
            .getBuyer(saleId, buyer.publicKey)
            .then((state) => {
              const amounts: BN[] = (state.contributions as any).map(
                (item) => item.amount
              );
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
        for (
          let tokenIndex = 0;
          tokenIndex < contributions.length;
          ++tokenIndex
        ) {
          for (const amount of contributions.at(tokenIndex)) {
            const solanaTx = await solanaContributor.contribute(
              buyer,
              saleId,
              tokenIndex,
              amount,
              await kyc.signContribution(
                saleId,
                tokenIndex,
                amount,
                buyer.publicKey
              )
            );
            console.log(
              `buyer ${i}, tokenIndex: ${tokenIndex}, contribute: ${solanaTx}`
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
      const assets = saleState.totals as any[];

      for (
        let tokenIndex = 0;
        tokenIndex < (assets.length as number);
        ++tokenIndex
      ) {
        const asset = assets.at(tokenIndex);
        expect(asset.allocations.toString()).to.equal("0");
        expect(asset.excessContributions.toString()).to.equal("0");

        const currentTotal: BN = asset.contributions;
        expect(
          currentTotal.sub(previousTotalContributions.at(tokenIndex)).toString()
        ).to.equal(
          endingBalanceCustodian
            .at(tokenIndex)
            .sub(startingBalanceCustodian.at(tokenIndex))
            .toString()
        );
      }

      // check buyers
      for (let i = 0; i < buyers.length; ++i) {
        const previousContributions = previousBuyerContributions.at(i);

        const buyer = buyers.at(i);
        const buyerState = await solanaContributor.getBuyer(
          saleId,
          buyer.publicKey
        );
        const buyerTotals = buyerState.contributions as any[];

        const startingBalance = startingBalanceBuyers.at(i);
        const endingBalance = endingBalanceBuyers.at(i);
        const contributions = buyerContributions.at(i);
        for (
          let tokenIndex = 0;
          tokenIndex < acceptedMints.length;
          ++tokenIndex
        ) {
          const expected = contributions
            .at(tokenIndex)
            .reduce((prev, curr) => prev.add(curr))
            .toString();

          // check buyer
          {
            expect(
              startingBalance
                .at(tokenIndex)
                .sub(endingBalance.at(tokenIndex))
                .toString()
            ).to.equal(expected);

            const current = buyerTotals.at(tokenIndex);
            expect(current.status).has.key(
              expected == "0" ? "inactive" : "active"
            );
            expect(current.excess.toString()).to.equal("0");

            const currentAmount: BN = current.amount;
            expect(
              currentAmount.sub(previousContributions.at(tokenIndex)).toString()
            ).to.equal(expected);
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
      const saleEnd = previousState.times.end.toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleEnd);

      const solanaResponse = await solanaContributor
        .attestContributions(solanaOrchestrator, saleId)
        .then((tx) => solanaConnection.getTransaction(tx));
      const sequence = parseSequenceFromLogSolana(solanaResponse);
      console.log(`attestContributions, sequence=${sequence}`);

      const { vaaBytes: signedVaa } = await getSignedVAAWithRetry(
        WORMHOLE_RPCS,
        CHAIN_ID_SOLANA,
        await getEmitterAddressSolana(
          solanaContributor.program.programId.toString()
        ),
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
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const avaxReceipt = await conductor.sealSale(
        ethers.BigNumber.from(saleId)
      );
      const sequences = parseSequencesFromLogEth(
        avaxReceipt,
        AVAX_CORE_BRIDGE_ADDRESS
      );
      console.log(
        `sealSale: ${avaxReceipt.transactionHash}, sequences: ${sequences}`
      );

      // first two are token bridge transfers
      // second two are saleSealed vaas (second one of which is what we need)
      expect(sequences).has.length(4);

      for (let i = 0; i < 2; ++i) {
        const signedVaa = await getSignedVaaFromAvaxTokenBridge(
          sequences.shift()
        );
        const [solanaTx, response] = await postAndRedeemTransferVaa(
          solanaConnection,
          solanaOrchestrator,
          signedVaa
        );
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

      const solanaTx = await solanaContributor.sealSale(
        solanaOrchestrator,
        signedVaa
      );
      console.log(`sealSale: ${solanaTx}`);

      // check sale status
      {
        const sale = await solanaContributor.getSale(saleId);
        expect(sale.status).has.key("sealed");

        const assets = sale.totals as any[];

        const conversionRates = parameters.acceptedTokens.map(
          (token) => new BN(token.conversionRate.toString())
        );
        const precisionDivisor = new BN("10").pow(new BN(parameters.precision));

        // expected amounts
        const maxRaise = unitsToUint("20000000", 6);
        const totalContributions: BN = assets
          .map((asset, i) =>
            asset.contributions.mul(conversionRates.at(i)).div(precisionDivisor)
          )
          .reduce((prev, curr) => prev.add(curr));
        const totalExpectedExcess = totalContributions.sub(maxRaise); // 3,000,000 USD
        const totalExpectedAllocation = new BN("1000000000000000000"); // 1,000,000,000

        for (let i = 0; i < conversionRates.length; ++i) {
          const asset = assets.at(i);
          expect(asset.assetStatus).has.key("readyForTransfer");

          const contributions = asset.contributions;

          // check excess
          {
            const expectedExcess = totalExpectedExcess
              .mul(contributions)
              .div(totalContributions);

            // there may be a slight loss in uint arithmetic from conductor (not likely though)
            const errorAmount = new BN("1");
            expect(
              asset.excessContributions.sub(expectedExcess).lte(errorAmount)
            ).to.be.true;
          }

          // check allocation
          {
            const contributionsNormalized = contributions
              .mul(conversionRates.at(i))
              .div(precisionDivisor);
            const expectedAllocation = totalExpectedAllocation
              .mul(contributionsNormalized)
              .div(totalContributions);

            // there may be a slight loss in uint arithmetic from conductor (not likely though)
            const errorAmount = new BN("1");
            expect(asset.allocations.sub(expectedAllocation).lte(errorAmount))
              .to.be.true;
          }
        }
      }
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const sale = await solanaContributor.getSale(saleId);
      const assets = sale.totals as any[];

      for (let i = 0; i < assets.length; ++i) {
        const asset = assets[i];
        if (asset.assetStatus.readyForTransfer) {
          const mint = asset.mint;
          console.log("attempting to bridge", mint.toString());
          const solanaTx = await solanaContributor.bridgeSealedContribution(
            solanaOrchestrator,
            saleId,
            mint
          );
          console.log(`solanaTx: ${solanaTx}`);
        }
      }
    });

    it("Users Claim Contribution Excess From Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const saleState = await solanaContributor.getSale(saleId);
      const assetTotals = saleState.totals as any[];
      const acceptedMints: web3.PublicKey[] = assetTotals.map(
        (asset) => asset.mint
      );

      for (const buyer of buyers) {
        const startingBalances = await Promise.all(
          acceptedMints.map(async (mint) => {
            return getSplBalance(solanaConnection, mint, buyer.publicKey);
          })
        );

        const tx = await solanaContributor.claimExcesses(buyer, saleId);

        const endingBalances = await Promise.all(
          acceptedMints.map(async (mint) => {
            return getSplBalance(solanaConnection, mint, buyer.publicKey);
          })
        );

        const buyerState = await solanaContributor.getBuyer(
          saleId,
          buyer.publicKey
        );
        const buyerTotals = buyerState.contributions as any[];

        for (let i = 0; i < acceptedMints.length; ++i) {
          const buyerTotal = buyerTotals.at(i);
          expect(buyerTotal.status).has.key("excessClaimed");

          const assetTotal = assetTotals.at(i);
          const expected = buyerTotal.amount
            .mul(assetTotal.excessContributions)
            .div(assetTotal.contributions);
          expect(buyerTotal.excess.toString()).to.equal(expected.toString());
          expect(
            endingBalances.at(i).sub(startingBalances.at(i)).toString()
          ).to.equal(expected.toString());
        }
      }
    });

    it("Users Claim Allocations From Sale on Solana Contributor", async () => {
      const saleId = currentSaleId;
      if (saleId == undefined) {
        throw Error("sale is not initialized");
      }

      const saleState = await solanaContributor.getSale(saleId);
      const saleUnlock = saleState.times.unlockAllocation.toNumber();
      await waitUntilSolanaBlock(solanaConnection, saleUnlock);

      for (const buyer of buyers) {
        const tx = await solanaContributor.claimAllocation(buyer, saleId);

        // TODO: balance check

        // get state
        const buyerState = await solanaContributor.getBuyer(
          saleId,
          buyer.publicKey
        );
        expect(buyerState.allocation.claimed).to.be.true;
      }
    });
  });
});
