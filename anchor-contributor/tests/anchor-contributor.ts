import { AnchorProvider, workspace, web3, Program, setProvider, BN } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import {
  CHAIN_ID_SOLANA,
  setDefaultWasm,
  tryNativeToHexString,
  getOriginalAssetSol,
  uint8ArrayToHex,
  CHAIN_ID_ETH,
  createWrappedOnSolana,
  getForeignAssetSolana,
  redeemOnSolana,
  ChainId,
} from "@certusone/wormhole-sdk";
import { getOrCreateAssociatedTokenAccount, mintTo, getMint, createMint } from "@solana/spl-token";

import { DummyConductor } from "./helpers/conductor";
import { IccoContributor } from "./helpers/contributor";
import {
  deriveAddress,
  getBlockTime,
  getPdaAssociatedTokenAddress,
  getPdaSplBalance,
  getSplBalance,
  hexToPublicKey,
  wait,
} from "./helpers/utils";
import { KycAuthority } from "./helpers/kyc";
import {
  CONDUCTOR_ADDRESS,
  CONDUCTOR_CHAIN,
  CORE_BRIDGE_ADDRESS,
  KYC_PRIVATE,
  TOKEN_BRIDGE_ADDRESS,
} from "./helpers/consts";
import { encodeAttestMeta, encodeTokenTransfer, parseTokenTransfer } from "./helpers/token-bridge";
import { signAndEncodeVaa } from "./helpers/wormhole";

// be careful where you import this
import { postVaaSolanaWithRetry } from "@certusone/wormhole-sdk";

setDefaultWasm("node");

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  setProvider(AnchorProvider.env());

  const program = workspace.AnchorContributor as Program<AnchorContributor>;
  const connection = program.provider.connection;

  const orchestrator = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./tests/test_orchestrator_keypair.json").toString()))
  );
  const buyer = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./tests/test_buyer_keypair.json").toString()))
  );

  // dummy conductor to generate vaas
  const dummyConductor = new DummyConductor(CONDUCTOR_CHAIN, CONDUCTOR_ADDRESS);

  // our contributor
  const contributor = new IccoContributor(program, CORE_BRIDGE_ADDRESS, TOKEN_BRIDGE_ADDRESS, postVaaSolanaWithRetry);

  // kyc for signing contributions
  const kyc = new KycAuthority(KYC_PRIVATE, CONDUCTOR_ADDRESS, contributor);

  // Mock Token Bridge on Ethereum. Used when we attest tokens on Solana.
  const ethTokenBridge = Buffer.from(
    tryNativeToHexString("0x0290FB167208Af455bB137780163b7B7a9a10C16", CHAIN_ID_ETH),
    "hex"
  );
  let ethTokenBridgeSequence = 0;

  before("Airdrop SOL", async () => {
    await connection.requestAirdrop(buyer.publicKey, 8000000000); // 8,000,000,000 lamports

    // do we need to wait for the airdrop to hit a wallet?
    await wait(5);
  });

  describe("Test Preparation", () => {
    it("Attest Accepted Token from Ethereum", async () => {
      // we have two token bridge actions: create wrapped and bridge
      // fabricate token address
      const tokenAddress = Buffer.alloc(32);
      tokenAddress.fill(105, 12);

      const attestMetaSignedVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++ethTokenBridgeSequence,
        encodeAttestMeta(tokenAddress, CHAIN_ID_ETH, 9, "WORTH", "Definitely Worth Something")
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        attestMetaSignedVaa,
        10
      );

      {
        const response = await createWrappedOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          orchestrator.publicKey.toString(),
          Uint8Array.from(attestMetaSignedVaa)
        )
          .then((transaction) => {
            transaction.partialSign(orchestrator);
            return connection.sendRawTransaction(transaction.serialize());
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      const mint = new web3.PublicKey(
        await getForeignAssetSolana(connection, TOKEN_BRIDGE_ADDRESS.toString(), CHAIN_ID_ETH, tokenAddress)
      );

      const tokenIndex = 2;
      dummyConductor.addAcceptedToken(tokenIndex, mint);

      // create ata for buyer
      const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);

      // now mint to buyer for testing
      let amount = new BN("200000000000");
      const tokenTransferSignedVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++ethTokenBridgeSequence,
        encodeTokenTransfer(amount.toString(), tokenAddress, CHAIN_ID_ETH, tokenAccount.address)
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        tokenTransferSignedVaa,
        10
      );
      {
        const response = await redeemOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          buyer.publicKey.toString(),
          Uint8Array.from(tokenTransferSignedVaa)
        )
          .then((transaction) => {
            transaction.partialSign(buyer);
            return connection.sendRawTransaction(transaction.serialize());
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      const balance = await getSplBalance(connection, mint, buyer.publicKey);
      expect(balance.toString()).to.equal(amount.toString());
    });

    it("Mint Accepted SPL Tokens to Buyer", async () => {
      // remaining token indices
      const tokenIndices = [3, 5, 8, 13, 21, 34];

      for (let i = 0; i < tokenIndices.length; ++i) {
        const mint = await createMint(connection, orchestrator, orchestrator.publicKey, orchestrator.publicKey, 9);
        dummyConductor.addAcceptedToken(tokenIndices.at(i), mint);

        // create ata for buyer
        const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);

        // now mint to buyer for testing
        let amount = new BN("200000000000");
        await mintTo(
          connection,
          orchestrator,
          mint,
          tokenAccount.address,
          orchestrator,
          BigInt(amount.toString()) // 20,000,000,000 lamports
        );

        const balance = await getSplBalance(connection, mint, buyer.publicKey);
        expect(balance.toString()).to.equal(amount.toString());
      }

      // make last index a non-existent token
      const lastTokenIndex = 55;
      dummyConductor.addAcceptedToken(
        lastTokenIndex,
        orchestrator.publicKey // obviously not a mint
      );
    });
  });

  describe("Custodian Setup", () => {
    it("Create Custodian", async () => {
      const tx = await contributor.createCustodian(orchestrator);

      // nothing to verify
    });
  });

  describe("Conduct Successful Sale (Native Solana Sale Token)", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    const saleTokenDecimals = 7;

    it("Create Sale Token Mint", async () => {
      // we need to simulate attesting the sale token on Solana.
      // this allows us to "redeem" the sale token prior to sealing the sale
      // (which in the case of this test means minting it on the contributor program's ATA)

      const saleTokenMint = await createMint(
        connection,
        orchestrator,
        orchestrator.publicKey,
        orchestrator.publicKey,
        saleTokenDecimals
      );
      dummyConductor.saveSaleTokenMint(saleTokenMint);
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        lockPeriod,
        dummyConductor.saleTokenOnSolana,
        CHAIN_ID_SOLANA,
        saleTokenDecimals
      );
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        expect(saleState.saleTokenMint.toString()).to.equal(dummyConductor.saleTokenOnSolana);
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");
        expect(saleState.contributionsBlocked).to.equal(false);

        const expectedSaleTokenAta = await getPdaAssociatedTokenAddress(saleState.saleTokenMint, contributor.custodian);
        expect(saleState.saleTokenAta.equals(expectedSaleTokenAta)).to.be.true;

        // check totals
        const totals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        const invalidTokenIndex = 7;
        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");

          if (i == invalidTokenIndex) {
            expect(total.assetStatus).has.key("invalidToken");
          } else {
            expect(total.assetStatus).has.key("active");
          }
        }
      }
    });

    it("Orchestrator Cannot Initialize Sale Again with Signed VAA", async () => {
      let caughtError = false;
      try {
        const tx = await contributor.initSale(orchestrator, dummyConductor.initSaleVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        // pda init should fail
        caughtError = "programErrorStack" in e;
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Cannot Contribute Too Early", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
        );
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "ContributionTooEarly");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Cannot Contribute With Bad Signature", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        // generate bad signature w/ amount that disagrees w/ instruction input
        const badSignature = await kyc.signContribution(saleId, tokenIndex, new BN("42069"), buyer.publicKey);
        const tx = await contributor.contribute(buyer, saleId, tokenIndex, amount, badSignature);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InvalidKycSignature");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Cannot Contribute to Invalidated Token Index", async () => {
      const saleId = dummyConductor.getSaleId();
      const invalidTokenIndex = 55;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      const saleState = await contributor.getSale(saleId);
      const totals = saleState.totals as any[];

      const asset = totals.find((total) => total.tokenIndex == invalidTokenIndex)!;
      expect(asset.assetStatus).has.key("invalidToken");

      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          invalidTokenIndex,
          amount,
          await kyc.signContribution(saleId, invalidTokenIndex, amount, buyer.publicKey)
        );
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "The program expected this account to be already initialized");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Contributes to Sale", async () => {
      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [acceptedTokens[0].index, acceptedTokens[3].index];
      contributions.set(contributedTokenIndices[0], ["1200000000", "3400000000"]);
      contributions.set(contributedTokenIndices[1], ["5600000000", "7800000000"]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      const acceptedMints = acceptedTokens.map((token) => hexToPublicKey(token.address));

      const startingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian);
        })
      );

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions.get(tokenIndex).map((value) => new BN(value))) {
          const tx = await contributor.contribute(
            buyer,
            saleId,
            tokenIndex,
            amount,
            await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
          );
        }
      }

      const endingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian);
        })
      );

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // check buyer state
      {
        const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
        const totals = buyerState.contributions as any[];
        expect(totals.length).to.equal(numExpected);

        // check balance changes and state
        for (let i = 0; i < numExpected; ++i) {
          let contribution = expectedContributedAmounts[i];
          expect(startingBalanceBuyer[i].sub(contribution).toString()).to.equal(endingBalanceBuyer[i].toString());
          expect(startingBalanceCustodian[i].add(contribution).toString()).to.equal(
            endingBalanceCustodian[i].toString()
          );

          let item = totals[i];
          const expectedState = contribution.eq(new BN("0")) ? "inactive" : "active";
          expect(item.status).has.key(expectedState);
          expect(item.amount.toString()).to.equal(contribution.toString());
          expect(item.excess.toString()).to.equal("0");
        }
      }

      // check sale state
      {
        const saleState = await contributor.getSale(saleId);
        const totals = saleState.totals as any[];
        expect(totals.length).to.equal(numExpected);

        for (let i = 0; i < numExpected; ++i) {
          const total = totals[i];
          expect(total.contributions.toString()).to.equal(expectedContributedAmounts[i].toString());
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("Orchestrator Cannot Attest Contributions Too Early", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.attestContributions(orchestrator, saleId);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleNotAttestable");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Attests Contributions", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      await waitUntilBlock(connection, saleEnd);
      const tx = await contributor.attestContributions(orchestrator, saleId);

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // now go about your business. read VAA back.
      await connection.confirmTransaction(tx);
      const vaaAccountInfo = await connection.getAccountInfo(
        contributor.deriveAttestContributionsMessageAccount(saleId),
        "confirmed"
      );
      const payload = vaaAccountInfo.data.subarray(95); // 95 is where the payload starts

      const headerLength = 33 + 32;
      const contributionLength = 33;
      expect(payload.length).to.equal(headerLength + 3 + contributionLength * numExpected);

      const payloadId = 2;
      expect(payload.readUint8(0)).to.equal(payloadId);
      expect(payload.subarray(1, 33).toString("hex")).to.equal(saleId.toString("hex"));
      expect(payload.readUint16BE(33)).to.equal(CHAIN_ID_SOLANA as number);

      const saleTokenAta = new web3.PublicKey(payload.subarray(35, 67));
      const saleState = await contributor.getSale(saleId);
      const expectedSaleTokenAta = await getPdaAssociatedTokenAddress(saleState.saleTokenMint, contributor.custodian);
      expect(saleTokenAta.equals(expectedSaleTokenAta)).to.be.true;

      expect(payload.readUint8(67)).to.equal(numExpected);

      const contributionsStart = headerLength + 3;
      for (let i = 0; i < dummyConductor.acceptedTokens.length; ++i) {
        const start = contributionsStart + contributionLength * i;

        const tokenIndex = payload.readUint8(start);
        expect(tokenIndex).to.equal(dummyConductor.acceptedTokens[i].index);

        const amount = new BN(payload.subarray(start + 1, start + 33));
        expect(amount.toString()).to.equal(expectedContributedAmounts[i].toString());
      }
    });

    it("User Cannot Contribute After Sale Ended", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
        );
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Cannot Seal Sale Without Allocation Bridge Transfers Redeemed", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InsufficientFunds");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Cannot Bridge Before SaleSealed VAA Processed", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      let caughtError = false;
      try {
        const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, assets[0].mint);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleNotSealed");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Seals Sale with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      // all we're doing here is minting spl tokens to replicate token bridge's mechanism
      // of unlocking or minting tokens to someone's associated token account
      await dummyConductor.redeemAllocationsOnSolana(connection, orchestrator, contributor.custodian);

      // now go about your business
      const allocations = dummyConductor.allocations;

      const tx = await contributor.sealSale(orchestrator, saleSealedVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        const totals = saleState.totals as any[];
        expect(totals.length).to.equal(allocations.length);

        const allocationDivisor = dummyConductor.getAllocationMultiplier();
        for (let i = 0; i < totals.length; ++i) {
          const actual = totals[i];
          const expected = allocations[i];

          const adjustedAllocation = new BN(expected.allocation).div(new BN(allocationDivisor)).toString();
          expect(actual.allocations.toString()).to.equal(adjustedAllocation);
          expect(actual.excessContributions.toString()).to.equal(expected.excessContribution);

          if (expected.allocation == "0") {
            expect(actual.assetStatus).has.key("nothingToTransfer");
          } else {
            expect(actual.assetStatus).has.key("readyForTransfer");
          }
        }
      }
    });

    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const expectedSealedAmounts = dummyConductor.allocations.map((item, i) =>
        expectedContributedAmounts[i].sub(new BN(item.excessContribution))
      );
      const numExpected = expectedSealedAmounts.length;

      // token bridge truncates to 8 decimals
      const tokenBridgeDecimals = 8;

      for (let i = 0; i < numExpected; ++i) {
        const asset = assets[i];
        if (asset.assetStatus.readyForTransfer) {
          const mint = asset.mint;
          const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, mint);

          // now go about your business. read VAA back.
          await connection.confirmTransaction(tx);
          const vaaAccountInfo = await connection.getAccountInfo(
            contributor.deriveSealedTransferMessageAccount(saleId, mint),
            "confirmed"
          );
          const payload = vaaAccountInfo.data.subarray(95); // 95 is where the payload starts
          expect(payload.length).to.equal(133); // 1 + 32 + 32 + 2 + 32 + 2 + 32
          expect(payload[0]).to.equal(1); // payload 1 is token transfer

          const parsedAmount = new BN(payload.subarray(1, 33));
          const mintInfo = await getMint(connection, mint);

          const divisor = (() => {
            const decimals = mintInfo.decimals;
            if (decimals > tokenBridgeDecimals) {
              return new BN("10").pow(new BN(decimals - tokenBridgeDecimals));
            } else {
              return new BN("1");
            }
          })();
          expect(parsedAmount.toString()).to.equal(expectedSealedAmounts[i].div(divisor).toString());

          const parsedTokenAddress = payload.subarray(33, 65);
          const parsedTokenChain = payload.readUint16BE(65);

          const tokenMintSigner = deriveAddress([Buffer.from("mint_signer")], TOKEN_BRIDGE_ADDRESS);
          if (mintInfo.mintAuthority.equals(tokenMintSigner)) {
            // wrapped, so get native info
            const nativeInfo = await getOriginalAssetSol(connection, TOKEN_BRIDGE_ADDRESS.toString(), mint.toString());
            expect(uint8ArrayToHex(nativeInfo.assetAddress)).to.equal(parsedTokenAddress.toString("hex"));
            expect(parsedTokenChain).to.equal(nativeInfo.chainId as number);
          } else {
            // native, so use pubkeys
            expect(new web3.PublicKey(parsedTokenAddress).toString()).to.equal(mint.toString());
            expect(parsedTokenChain).to.equal(CHAIN_ID_SOLANA as number);
          }

          const parsedTo = payload.subarray(67, 99);
          expect(parsedTo.toString("hex")).to.equal(dummyConductor.recipient);

          const parsedToChain = payload.readUint16BE(99);
          expect(parsedToChain).to.equal(CONDUCTOR_CHAIN);

          const parsedFee = payload.subarray(101, 133);
          expect(new BN(parsedFee).toString()).to.equal("0");
        } else {
          let caughtError = false;
          try {
            const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, asset.mint);
            throw new Error(`should not happen: ${tx}`);
          } catch (e) {
            caughtError =
              verifyErrorMsg(e, "TransferNotAllowed", false) || verifyErrorMsg(e, "TokenInvalidAccountOwnerError");
          }

          if (!caughtError) {
            throw new Error("did not catch expected error");
          }
        }
      }
    });

    it("Orchestrator Cannot Bridge Contribution Again", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      let caughtError = false;
      try {
        const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, assets[0].mint);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "TransferNotAllowed");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Claims Contribution Excess From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      const startingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const tx = await contributor.claimExcesses(buyer, saleId);

      const endingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      // verify excesses
      const expectedExcessAmounts = dummyConductor.allocations.map((item) => new BN(item.excessContribution));
      const numExpected = expectedExcessAmounts.length;

      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const totals = buyerState.contributions as any[];
      expect(totals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let excess = expectedExcessAmounts[i];

        expect(startingBalanceBuyer[i].add(excess).toString()).to.equal(endingBalanceBuyer[i].toString());
        expect(startingBalanceCustodian[i].sub(excess).toString()).to.equal(endingBalanceCustodian[i].toString());

        const item = totals[i];
        expect(item.status).has.key("excessClaimed");
        expect(item.excess.toString()).to.equal(excess.toString());
      }
    });

    it("User Cannot Claim Excess Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimExcesses(buyer, saleId);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Cannot Claim Allocations Before Sale Unlock", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimAllocation(buyer, saleId);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AllocationsLocked");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Claims Allocations From Sale", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait until unlock
      const saleUnlock = dummyConductor.saleUnlock;
      await waitUntilBlock(connection, saleUnlock);

      const tx = await contributor.claimAllocation(buyer, saleId);

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      expect(buyerState.allocation.claimed).to.be.true;

      const allocationDivisor = new BN(dummyConductor.getAllocationMultiplier());
      const expectedAllocation = dummyConductor.allocations
        .map((item) => new BN(item.allocation))
        .reduce((prev, curr) => prev.add(curr))
        .div(allocationDivisor);
      expect(buyerState.allocation.amount.toString()).to.equal(expectedAllocation.toString());
    });

    it("User Cannot Claim Allocations Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimAllocation(buyer, saleId);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });
  });

  describe("Conduct Aborted Sale (Native Solana Sale Token)", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        lockPeriod,
        dummyConductor.tokenAddress,
        dummyConductor.tokenChain,
        dummyConductor.tokenDecimals
      );
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        expect(saleState.saleTokenMint.toString()).to.equal(dummyConductor.saleTokenOnSolana);
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.nativeTokenDecimals).to.equal(dummyConductor.nativeTokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");
        expect(saleState.contributionsBlocked).to.equal(false);

        const expectedSaleTokenAta = await getPdaAssociatedTokenAddress(saleState.saleTokenMint, contributor.custodian);
        expect(saleState.saleTokenAta.equals(expectedSaleTokenAta)).to.be.true;

        // check totals
        const totals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [acceptedTokens[0].index, acceptedTokens[3].index];
      contributions.set(contributedTokenIndices[0], ["1200000000", "3400000000"]);
      contributions.set(contributedTokenIndices[1], ["5600000000", "7800000000"]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions.get(tokenIndex).map((value) => new BN(value))) {
          const tx = await contributor.contribute(
            buyer,
            saleId,
            tokenIndex,
            amount,
            await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
          );
        }
      }
    });

    it("Orchestrator Aborts Sale with Signed VAA", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(await getBlockTime(connection));
      const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);
        expect(saleState.status).has.key("aborted");
      }
    });

    it("Orchestrator Cannot Abort Sale Again", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(await getBlockTime(connection));
      // cannot abort the sale again

      let caughtError = false;
      try {
        const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("User Claims Refund From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      const startingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const tx = await contributor.claimRefunds(buyer, saleId);

      const endingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const expectedRefundAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedRefundAmounts.length;

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const totals = buyerState.contributions as any[];
      expect(totals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let refund = expectedRefundAmounts[i];

        expect(startingBalanceBuyer[i].add(refund).toString()).to.equal(endingBalanceBuyer[i].toString());
        expect(startingBalanceCustodian[i].sub(refund).toString()).to.equal(endingBalanceCustodian[i].toString());

        const item = totals[i];
        expect(item.status).has.key("refundClaimed");
        expect(item.excess.toString()).to.equal(refund.toString());
      }
    });

    it("User Cannot Claim Refund Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimRefunds(buyer, saleId);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });
  });

  describe("Conduct Blocked Sale", () => {
    it("Orchestrator Initialized Blocked Sale By Using Non-Existent Sale Token", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended

      // Sale token is non-existent token. THIS SHOULD NEVER HAPPEN FROM THE CONDUCTOR!
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        lockPeriod,
        orchestrator.publicKey.toString(), // obviously not an SPL token
        CHAIN_ID_SOLANA,
        7
      );
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        // saleTokenMint is zero address
        expect(saleState.saleTokenMint.equals(web3.PublicKey.default)).to.be.true;
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        // token decimals is zero for non-existent token
        expect(saleState.nativeTokenDecimals).to.equal(0);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");
        expect(saleState.contributionsBlocked).to.equal(true);

        // saleTokenAta is zero address
        expect(saleState.saleTokenAta.equals(web3.PublicKey.default)).to.be.true;

        // check totals
        const totals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("User Cannot Contribute to Blocked Sale", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      // now go about your business
      // contribute multiple times
      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
        );
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        // Contribution should fail
        caughtError = verifyErrorMsg(e, "SaleContributionsAreBlocked");
      }
      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Attests Contributions", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      await waitUntilBlock(connection, saleEnd);
      const tx = await contributor.attestContributions(orchestrator, saleId);

      const expectedContributedAmounts = [
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // now go about your business. read VAA back.
      await connection.confirmTransaction(tx);
      const vaaAccountInfo = await connection.getAccountInfo(
        contributor.deriveAttestContributionsMessageAccount(saleId),
        "confirmed"
      );
      const payload = vaaAccountInfo.data.subarray(95); // 95 is where the payload starts

      const headerLength = 33 + 32;
      const contributionLength = 33;
      expect(payload.length).to.equal(headerLength + 3 + contributionLength * numExpected);

      const payloadId = 2;
      expect(payload.readUint8(0)).to.equal(payloadId);
      expect(payload.subarray(1, 33).toString("hex")).to.equal(saleId.toString("hex"));
      expect(payload.readUint16BE(33)).to.equal(CHAIN_ID_SOLANA as number);

      const saleTokenAta = new web3.PublicKey(payload.subarray(35, 67));
      expect(saleTokenAta.equals(web3.PublicKey.default)).to.be.true;

      expect(payload.readUint8(67)).to.equal(numExpected);

      const contributionsStart = headerLength + 3;
      for (let i = 0; i < dummyConductor.acceptedTokens.length; ++i) {
        const start = contributionsStart + contributionLength * i;

        const tokenIndex = payload.readUint8(start);
        expect(tokenIndex).to.equal(dummyConductor.acceptedTokens[i].index);

        const amount = new BN(payload.subarray(start + 1, start + 33));
        expect(amount.toString()).to.equal(expectedContributedAmounts[i].toString());
      }
    });
  });

  describe("Conduct Successful Sale (Token Bridge Wrapped Sale Token)", () => {
    // Sale Token Address foreign to Solana (bridged from Ethereum)
    const foreignSaleTokenAddress = Buffer.alloc(32);
    foreignSaleTokenAddress.fill(42, 12);

    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    it("Orchestrator Cannot Initialize Before Attesting Sale Token", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended

      // sale token is not Token Bridge wrapped, but the token chain
      // indicates it is
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        lockPeriod,
        "0x" + foreignSaleTokenAddress.subarray(12, 32).toString("hex"),
        CHAIN_ID_ETH,
        18
      );

      let caughtError = false;
      try {
        const tx = await contributor.initSale(orchestrator, initSaleVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        // Contribution should fail
        caughtError = verifyErrorMsg(e, "SaleTokenNotAttested");
      }
      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    // Sale number two. This one is good.
    it("Orchestrator Attests Sale Token from Ethereum", async () => {
      const attestVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++ethTokenBridgeSequence,
        encodeAttestMeta(
          foreignSaleTokenAddress,
          dummyConductor.tokenChain,
          dummyConductor.tokenDecimals,
          "SALE",
          "Token for Sale"
        )
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        attestVaa,
        10
      );

      {
        const response = await createWrappedOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          orchestrator.publicKey.toString(),
          Uint8Array.from(attestVaa)
        )
          .then((transaction) => {
            transaction.partialSign(orchestrator);
            return connection.sendRawTransaction(transaction.serialize());
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      const mint = new web3.PublicKey(
        await getForeignAssetSolana(connection, TOKEN_BRIDGE_ADDRESS.toString(), CHAIN_ID_ETH, foreignSaleTokenAddress)
      );
    });

    it("Orchestrator Initializes Sale with Signed VAA", async () => {
      const tx = await contributor.initSale(orchestrator, dummyConductor.initSaleVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        expect(saleState.tokenChain).to.equal(CHAIN_ID_ETH as number);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.nativeTokenDecimals).to.equal(dummyConductor.nativeTokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");
        expect(saleState.contributionsBlocked).to.equal(false);

        const expectedSaleTokenAta = await getPdaAssociatedTokenAddress(saleState.saleTokenMint, contributor.custodian);
        expect(saleState.saleTokenAta.equals(expectedSaleTokenAta)).to.be.true;

        // check totals
        const totals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [acceptedTokens[0].index, acceptedTokens[3].index];
      contributions.set(contributedTokenIndices[0], ["1200000000", "3400000000"]);
      contributions.set(contributedTokenIndices[1], ["5600000000", "7800000000"]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      const acceptedMints = acceptedTokens.map((token) => hexToPublicKey(token.address));

      const startingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey).catch((_) => new BN(0));
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian).catch((_) => new BN(0));
        })
      );

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions.get(tokenIndex).map((value) => new BN(value))) {
          const tx = await contributor.contribute(
            buyer,
            saleId,
            tokenIndex,
            amount,
            await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
          );
        }
      }

      const endingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian);
        })
      );

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // check buyer state
      {
        const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
        const totals = buyerState.contributions as any[];
        expect(totals.length).to.equal(numExpected);

        // check balance changes and state
        for (let i = 0; i < numExpected; ++i) {
          let contribution = expectedContributedAmounts[i];
          expect(startingBalanceBuyer[i].sub(contribution).toString()).to.equal(endingBalanceBuyer[i].toString());
          expect(startingBalanceCustodian[i].add(contribution).toString()).to.equal(
            endingBalanceCustodian[i].toString()
          );

          let item = totals[i];
          const expectedState = contribution.eq(new BN("0")) ? "inactive" : "active";
          expect(item.status).has.key(expectedState);
          expect(item.amount.toString()).to.equal(contribution.toString());
          expect(item.excess.toString()).to.equal("0");
        }
      }

      // check sale state
      {
        const saleState = await contributor.getSale(saleId);
        const totals = saleState.totals as any[];
        expect(totals.length).to.equal(numExpected);

        for (let i = 0; i < numExpected; ++i) {
          const total = totals[i];
          expect(total.contributions.toString()).to.equal(expectedContributedAmounts[i].toString());
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("Orchestrator Attests Contributions", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      await waitUntilBlock(connection, saleEnd);
      const tx = await contributor.attestContributions(orchestrator, saleId);

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // now go about your business. read VAA back.
      await connection.confirmTransaction(tx);
      const vaaAccountInfo = await connection.getAccountInfo(
        contributor.deriveAttestContributionsMessageAccount(saleId),
        "confirmed"
      );
      const payload = vaaAccountInfo.data.subarray(95); // 95 is where the payload starts

      const headerLength = 33 + 32;
      const contributionLength = 33;
      expect(payload.length).to.equal(headerLength + 3 + contributionLength * numExpected);

      const payloadId = 2;
      expect(payload.readUint8(0)).to.equal(payloadId);
      expect(payload.subarray(1, 33).toString("hex")).to.equal(saleId.toString("hex"));
      expect(payload.readUint16BE(33)).to.equal(CHAIN_ID_SOLANA as number);

      const saleTokenAta = new web3.PublicKey(payload.subarray(35, 67));
      const saleState = await contributor.getSale(saleId);
      const expectedSaleTokenAta = await getPdaAssociatedTokenAddress(saleState.saleTokenMint, contributor.custodian);
      expect(saleTokenAta.equals(expectedSaleTokenAta)).to.be.true;

      expect(payload.readUint8(67)).to.equal(numExpected);

      const contributionsStart = headerLength + 3;
      for (let i = 0; i < dummyConductor.acceptedTokens.length; ++i) {
        const start = contributionsStart + contributionLength * i;

        const tokenIndex = payload.readUint8(start);
        expect(tokenIndex).to.equal(dummyConductor.acceptedTokens[i].index);

        const amount = new BN(payload.subarray(start + 1, start + 33));
        expect(amount.toString()).to.equal(expectedContributedAmounts[i].toString());
      }
    });

    it("Orchestrator Cannot Seal Sale Without Allocation Bridge Transfers Redeemed", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw new Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InsufficientFunds");
      }

      if (!caughtError) {
        throw new Error("did not catch expected error");
      }
    });

    it("Orchestrator Seals Sale with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      const totalAllocations = dummyConductor.totalAllocations
        .div(new BN(dummyConductor.getAllocationMultiplier()))
        .toString();

      const saleTokenMint = new web3.PublicKey(
        await getForeignAssetSolana(
          connection,
          TOKEN_BRIDGE_ADDRESS.toString(),
          dummyConductor.tokenChain as ChainId,
          Uint8Array.from(foreignSaleTokenAddress)
        )
      );
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        saleTokenMint,
        contributor.custodian,
        true
      );
      const tokenTransferSignedVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++ethTokenBridgeSequence,
        encodeTokenTransfer(totalAllocations, foreignSaleTokenAddress, dummyConductor.tokenChain, tokenAccount.address)
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        tokenTransferSignedVaa,
        10
      );

      {
        const response = await redeemOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          orchestrator.publicKey.toString(),
          Uint8Array.from(tokenTransferSignedVaa)
        )
          .then((transaction) => {
            transaction.partialSign(orchestrator);
            return connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      // now go about your business
      const allocations = dummyConductor.allocations;

      const tx = await contributor.sealSale(orchestrator, saleSealedVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        const totals = saleState.totals as any[];
        expect(totals.length).to.equal(allocations.length);

        const allocationDivisor = dummyConductor.getAllocationMultiplier();
        for (let i = 0; i < totals.length; ++i) {
          const actual = totals[i];
          const expected = allocations[i];

          const adjustedAllocation = new BN(expected.allocation).div(new BN(allocationDivisor)).toString();
          expect(actual.allocations.toString()).to.equal(adjustedAllocation);
          expect(actual.excessContributions.toString()).to.equal(expected.excessContribution);

          if (expected.allocation == "0") {
            expect(actual.assetStatus).has.key("nothingToTransfer");
          } else {
            expect(actual.assetStatus).has.key("readyForTransfer");
          }
        }
      }
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      const expectedContributedAmounts = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const expectedSealedAmounts = dummyConductor.allocations.map((item, i) =>
        expectedContributedAmounts[i].sub(new BN(item.excessContribution))
      );
      const numExpected = expectedSealedAmounts.length;

      // token bridge truncates to 8 decimals
      const tokenBridgeDecimals = 8;

      for (let i = 0; i < numExpected; ++i) {
        const asset = assets[i];
        if (asset.assetStatus.readyForTransfer) {
          const mint = asset.mint;
          const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, mint);

          // now go about your business. read VAA back.
          await connection.confirmTransaction(tx);
          const vaaAccountInfo = await connection.getAccountInfo(
            contributor.deriveSealedTransferMessageAccount(saleId, mint),
            "confirmed"
          );
          const payload = vaaAccountInfo.data.subarray(95); // 95 is where the payload starts
          expect(payload.length).to.equal(133); // 1 + 32 + 32 + 2 + 32 + 2 + 32
          expect(payload[0]).to.equal(1); // payload 1 is token transfer

          const parsedAmount = new BN(payload.subarray(1, 33));
          const mintInfo = await getMint(connection, mint);

          const divisor = (() => {
            const decimals = mintInfo.decimals;
            if (decimals > tokenBridgeDecimals) {
              return new BN("10").pow(new BN(decimals - tokenBridgeDecimals));
            } else {
              return new BN("1");
            }
          })();
          expect(parsedAmount.toString()).to.equal(expectedSealedAmounts[i].div(divisor).toString());

          const parsedTokenAddress = payload.subarray(33, 65);
          const parsedTokenChain = payload.readUint16BE(65);

          const tokenMintSigner = deriveAddress([Buffer.from("mint_signer")], TOKEN_BRIDGE_ADDRESS);
          if (mintInfo.mintAuthority.equals(tokenMintSigner)) {
            // wrapped, so get native info
            const nativeInfo = await getOriginalAssetSol(connection, TOKEN_BRIDGE_ADDRESS.toString(), mint.toString());
            expect(uint8ArrayToHex(nativeInfo.assetAddress)).to.equal(parsedTokenAddress.toString("hex"));
            expect(parsedTokenChain).to.equal(nativeInfo.chainId as number);
          } else {
            // native, so use pubkeys
            expect(new web3.PublicKey(parsedTokenAddress).toString()).to.equal(mint.toString());
            expect(parsedTokenChain).to.equal(CHAIN_ID_SOLANA as number);
          }

          const parsedTo = payload.subarray(67, 99);
          expect(parsedTo.toString("hex")).to.equal(dummyConductor.recipient);

          const parsedToChain = payload.readUint16BE(99);
          expect(parsedToChain).to.equal(CONDUCTOR_CHAIN);

          const parsedFee = payload.subarray(101, 133);
          expect(new BN(parsedFee).toString()).to.equal("0");
        } else {
          let caughtError = false;
          try {
            const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, asset.mint);
            throw new Error(`should not happen: ${tx}`);
          } catch (e) {
            caughtError =
              verifyErrorMsg(e, "TransferNotAllowed", false) || verifyErrorMsg(e, "TokenInvalidAccountOwnerError");
          }

          if (!caughtError) {
            throw new Error("did not catch expected error");
          }
        }
      }
    });

    it("User Claims Contribution Excess From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assets = sale.totals as any[];

      const startingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const tx = await contributor.claimExcesses(buyer, saleId);

      const endingBalanceBuyer = await Promise.all(
        assets.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        assets.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      // verify excesses
      const expectedExcessAmounts = dummyConductor.allocations.map((item) => new BN(item.excessContribution));
      const numExpected = expectedExcessAmounts.length;

      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const totals = buyerState.contributions as any[];
      expect(totals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let excess = expectedExcessAmounts[i];

        expect(startingBalanceBuyer[i].add(excess).toString()).to.equal(endingBalanceBuyer[i].toString());
        expect(startingBalanceCustodian[i].sub(excess).toString()).to.equal(endingBalanceCustodian[i].toString());

        const item = totals[i];
        expect(item.status).has.key("excessClaimed");
        expect(item.excess.toString()).to.equal(excess.toString());
      }
    });

    it("User Claims Allocations From Sale", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait until unlock
      const saleUnlock = dummyConductor.saleUnlock;
      await waitUntilBlock(connection, saleUnlock);

      const tx = await contributor.claimAllocation(buyer, saleId);

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      expect(buyerState.allocation.claimed).to.be.true;

      const allocationDivisor = new BN(dummyConductor.getAllocationMultiplier());
      const expectedAllocation = dummyConductor.allocations
        .map((item) => new BN(item.allocation))
        .reduce((prev, curr) => prev.add(curr))
        .div(allocationDivisor);
      expect(buyerState.allocation.amount.toString()).to.equal(expectedAllocation.toString());
    });
  });
});

async function waitUntilBlock(connection: web3.Connection, expiration: number) {
  let blockTime = await getBlockTime(connection);
  while (blockTime <= expiration) {
    await wait(1);
    blockTime = await getBlockTime(connection);
  }
}

function verifyErrorMsg(e: any, msg: string, log: boolean = true): boolean {
  if (e.toString() == msg) {
    return true;
  } else if (e.msg) {
    const result = e.msg == msg;
    if (!result && log) {
      console.error(e);
    }
    return result;
  } else if (e.error) {
    const result = e.error.errorMessage == msg;
    if (!result && log) {
      console.error(e);
    }
    return result;
  }

  if (log) {
    console.error(e);
  }
  return false;
}
