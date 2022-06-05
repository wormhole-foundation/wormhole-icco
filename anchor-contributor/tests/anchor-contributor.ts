import {
  AnchorProvider,
  workspace,
  web3,
  Program,
  setProvider,
  BN,
} from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import {
  CHAIN_ID_SOLANA,
  setDefaultWasm,
  tryHexToNativeString,
  tryNativeToHexString,
  transferFromSolana,
  tryUint8ArrayToNative,
  importCoreWasm,
} from "@certusone/wormhole-sdk";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  Account as AssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";

import { DummyConductor } from "./helpers/conductor";
import { IccoContributor } from "./helpers/contributor";
import {
  getBlockTime,
  getPdaAssociatedTokenAddress,
  getPdaSplBalance,
  getSplBalance,
  hexToPublicKey,
  wait,
} from "./helpers/utils";
import { BigNumber } from "ethers";
import { KycAuthority } from "./helpers/kyc";
import { findAttestContributionsMsgAccount } from "./helpers/accounts";
import {
  CONDUCTOR_ADDRESS,
  CONDUCTOR_CHAIN,
  CORE_BRIDGE_ADDRESS,
  KYC_PRIVATE,
  TOKEN_BRIDGE_ADDRESS,
} from "./helpers/consts";

// be careful where you import this
import { postVaaSolanaWithRetry } from "@certusone/wormhole-sdk";

setDefaultWasm("node");

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  setProvider(AnchorProvider.env());

  const program = workspace.AnchorContributor as Program<AnchorContributor>;
  const connection = program.provider.connection;

  const orchestrator = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync("./tests/test_orchestrator_keypair.json").toString()
      )
    )
  );
  const buyer = web3.Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync("./tests/test_buyer_keypair.json").toString())
    )
  );

  // dummy conductor to generate vaas
  const dummyConductor = new DummyConductor(CONDUCTOR_CHAIN, CONDUCTOR_ADDRESS);

  // our contributor
  const contributor = new IccoContributor(
    program,
    CORE_BRIDGE_ADDRESS,
    postVaaSolanaWithRetry
  );

  // kyc for signing contributions
  const kyc = new KycAuthority(KYC_PRIVATE, CONDUCTOR_ADDRESS, contributor);

  before("Airdrop SOL", async () => {
    await connection.requestAirdrop(buyer.publicKey, 8000000000); // 8,000,000,000 lamports

    // do we need to wait for the airdrop to hit a wallet?
    await wait(5);
  });

  describe("Test Preparation", () => {
    it("Create Dummy Sale Token", async () => {
      // we need to simulate attesting the sale token on Solana.
      // this allows us to "redeem" the sale token prior to sealing the sale
      // (which in the case of this test means minting it on the contributor program's ATA)
      await dummyConductor.attestSaleToken(connection, orchestrator);
    });

    it("Bridge Sale Token To Null Recipient", async () => {
      // we need to simulate attesting the sale token on Solana.
      // this allows us to "redeem" the sale token prior to sealing the sale
      // (which in the case of this test means minting it on the contributor program's ATA)
      //ait dummyConductor.attestSaleToken(connection, orchestrator);

      const saleTokenMint = dummyConductor.getSaleTokenOnSolana();
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        orchestrator.publicKey
      );
      await mintTo(
        connection,
        orchestrator,
        saleTokenMint,
        tokenAccount.address,
        orchestrator,
        1n
      );

      const transaction = await transferFromSolana(
        connection,
        CORE_BRIDGE_ADDRESS.toString(),
        TOKEN_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        tokenAccount.address.toString(),
        saleTokenMint.toString(),
        1n,
        new Uint8Array(32), // null address
        "ethereum"
      );
      transaction.partialSign(orchestrator);
      const txid = await connection.sendRawTransaction(transaction.serialize());
    });

    it("Mint Accepted SPL Tokens to Buyer", async () => {
      // first create them and add them to the accepted tokens list
      const acceptedTokens = await dummyConductor.createAcceptedTokens(
        connection,
        orchestrator
      );

      for (const token of acceptedTokens) {
        const mint = hexToPublicKey(token.address);

        // create ata for buyer
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          buyer,
          mint,
          buyer.publicKey
        );

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
    });
  });

  describe("Custodian Setup", () => {
    it("Create Custodian", async () => {
      const tx = await contributor.createCustodian(orchestrator);

      // get the custodian state
      const custodianState = await contributor.getCustodian();

      // verify
      expect(custodianState.owner.toString()).to.equal(
        orchestrator.publicKey.toString()
      );
    });

    it("Create ATAs for Custodian", async () => {
      for (const token of dummyConductor.acceptedTokens) {
        const mint = new web3.PublicKey(
          tryHexToNativeString(token.address, CHAIN_ID_SOLANA)
        );

        const allowOwnerOffCurve = true;
        await getOrCreateAssociatedTokenAccount(
          connection,
          orchestrator,
          mint,
          contributor.custodianAccount.key,
          allowOwnerOffCurve
        );
      }
    });
  });

  describe("Conduct Successful Sale", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      const allowOwnerOffCurve = true;
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        contributor.custodianAccount.key,
        allowOwnerOffCurve
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        saleTokenAccount.address
      );
      const tx = await contributor.initSale(
        orchestrator,
        initSaleVaa,
        dummyConductor.getSaleTokenOnSolana()
      );

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        //expect(Uint8Array.from(saleState.tokenAddress)).to.deep.equal(Buffer.from(dummyConductor.tokenAddress, "hex"));
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.times.start.toString()).to.equal(
          dummyConductor.saleStart.toString()
        );
        expect(saleState.times.end.toString()).to.equal(
          dummyConductor.saleEnd.toString()
        );
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(
          Buffer.from(dummyConductor.recipient, "hex")
        );
        expect(saleState.status).has.key("active");

        // check totals
        const totals: any = saleState.totals;
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(
            tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)
          ).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("Orchestrator Cannot Initialize Sale Again with Signed VAA", async () => {
      let caughtError = false;
      try {
        const tx = await contributor.initSale(
          orchestrator,
          dummyConductor.initSaleVaa,
          dummyConductor.getSaleTokenOnSolana()
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        // pda init should fail
        caughtError = "programErrorStack" in e;
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
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
          await kyc.signContribution(
            saleId,
            tokenIndex,
            amount,
            buyer.publicKey
          )
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "ContributionTooEarly");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
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
        const badSignature = await kyc.signContribution(
          saleId,
          tokenIndex,
          new BN("42069"),
          buyer.publicKey
        );
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          badSignature
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InvalidKycSignature");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Contributes to Sale", async () => {
      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [
        acceptedTokens[0].index,
        acceptedTokens[3].index,
      ];
      contributions.set(contributedTokenIndices[0], [
        "1200000000",
        "3400000000",
      ]);
      contributions.set(contributedTokenIndices[1], [
        "5600000000",
        "7800000000",
      ]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(
          amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr))
        );
      });

      const startingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
        })
      );

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions
          .get(tokenIndex)
          .map((value) => new BN(value))) {
          const tx = await contributor.contribute(
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
        }
      }

      const endingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
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
        const totals: any = buyerState.contributions;
        expect(totals.length).to.equal(numExpected);

        // check balance changes and state
        for (let i = 0; i < numExpected; ++i) {
          let contribution = expectedContributedAmounts[i];
          expect(startingBalanceBuyer[i].sub(contribution).toString()).to.equal(
            endingBalanceBuyer[i].toString()
          );
          expect(
            startingBalanceCustodian[i].add(contribution).toString()
          ).to.equal(endingBalanceCustodian[i].toString());

          let item = totals[i];
          const expectedState = contribution.eq(new BN("0"))
            ? "inactive"
            : "active";
          expect(item.status).has.key(expectedState);
          expect(item.amount.toString()).to.equal(contribution.toString());
          expect(item.excess.toString()).to.equal("0");
        }
      }

      // check sale state
      {
        const saleState = await contributor.getSale(saleId);
        const totals: any = saleState.totals;
        expect(totals.length).to.equal(numExpected);

        for (let i = 0; i < numExpected; ++i) {
          const total = totals[i];
          expect(total.contributions.toString()).to.equal(
            expectedContributedAmounts[i].toString()
          );
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
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleNotAttestable");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Attests Contributions", async () => {
      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      const saleId = dummyConductor.getSaleId();
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
        findAttestContributionsMsgAccount(program.programId, saleId).key,
        "confirmed"
      );
      const attestContributionsVaa = vaaAccountInfo.data;

      const headerLength = 33;
      const contributionLength = 33;
      const payloadLength = headerLength + 3 + contributionLength * numExpected;
      const payload = attestContributionsVaa.slice(-payloadLength);

      const payloadId = 2;
      expect(payload.readUint8(0)).to.equal(payloadId);
      expect(payload.subarray(1, 33).toString("hex")).to.equal(
        saleId.toString("hex")
      );
      expect(payload.readUint16BE(33)).to.equal(CHAIN_ID_SOLANA as number);
      expect(payload.readUint8(35)).to.equal(numExpected);

      const contributionsStart = headerLength + 3;
      for (let i = 0; i < dummyConductor.acceptedTokens.length; ++i) {
        const start = contributionsStart + contributionLength * i;

        const tokenIndex = payload.readUint8(start);
        expect(tokenIndex).to.equal(dummyConductor.acceptedTokens[i].index);

        const amount = new BN(payload.subarray(start + 1, start + 33));
        expect(amount.toString()).to.equal(
          expectedContributedAmounts[i].toString()
        );
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
          await kyc.signContribution(
            saleId,
            tokenIndex,
            amount,
            buyer.publicKey
          )
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Cannot Seal Sale Without Allocation Bridge Transfers Redeemed", async () => {
      const saleSealedVaa = dummyConductor.sealSale(
        await getBlockTime(connection),
        contributions
      );
      const saleTokenMint = dummyConductor.getSaleTokenOnSolana();

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(
          orchestrator,
          saleSealedVaa,
          saleTokenMint
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InsufficientFunds");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Seals Sale with Signed VAA", async () => {
      // all we're doing here is minting spl tokens to replicate token bridge's mechanism
      // of unlocking or minting tokens to someone's associated token account
      await dummyConductor.redeemAllocationsOnSolana(
        connection,
        orchestrator,
        contributor.custodianAccount.key
      );

      // now go about your business
      const saleSealedVaa = dummyConductor.sealSale(
        await getBlockTime(connection),
        contributions
      );
      const saleTokenMint = dummyConductor.getSaleTokenOnSolana();
      const allocations = dummyConductor.allocations;

      const tx = await contributor.sealSale(
        orchestrator,
        saleSealedVaa,
        saleTokenMint
      );

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        const totals: any = saleState.totals;
        expect(totals.length).to.equal(allocations.length);

        const allocationDivisor = dummyConductor.getAllocationMultiplier();
        for (let i = 0; i < totals.length; ++i) {
          const actual = totals[i];
          const expected = allocations[i];

          const adjustedAllocation = BigNumber.from(expected.allocation)
            .div(allocationDivisor)
            .toString();
          expect(actual.allocations.toString()).to.equal(adjustedAllocation);
          expect(actual.excessContributions.toString()).to.equal(
            expected.excessContribution
          );
        }
      }
    });

    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(
        await getBlockTime(connection),
        contributions
      );
      const saleTokenMint = dummyConductor.getSaleTokenOnSolana();

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(
          orchestrator,
          saleSealedVaa,
          saleTokenMint
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      const saleId = dummyConductor.getSaleId();
      const acceptedTokens = dummyConductor.acceptedTokens;
      const tx = await contributor.bridgeSealedContribution(
        orchestrator,
        saleId,
        hexToPublicKey(acceptedTokens[0].address)
      );
    });

    // TODO
    it("User Claims Allocations From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const acceptedTokens = dummyConductor.acceptedTokens;
      const acceptedMints = acceptedTokens.map((token) => {
        return hexToPublicKey(token.address);
      });

      const startingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
        })
      );

      const tx = await contributor.claimAllocation(
        buyer,
        saleId,
        dummyConductor.getSaleTokenOnSolana(),
        acceptedMints
      );

      const endingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
        })
      );

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      expect(buyerState.allocation.claimed).to.be.true;

      const allocationDivisor = new BN(
        dummyConductor.getAllocationMultiplier()
      );
      const expectedAllocation = dummyConductor.allocations
        .map((item) => new BN(item.allocation))
        .reduce((prev, curr) => prev.add(curr))
        .div(allocationDivisor);
      expect(buyerState.allocation.amount.toString()).to.equal(
        expectedAllocation.toString()
      );

      const expectedExcessAmounts = dummyConductor.allocations.map(
        (item) => new BN(item.excessContribution)
      );
      const numExpected = expectedExcessAmounts.length;

      const totals: any = buyerState.contributions;
      expect(totals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let excess = expectedExcessAmounts[i];

        expect(startingBalanceBuyer[i].add(excess).toString()).to.equal(
          endingBalanceBuyer[i].toString()
        );
        expect(startingBalanceCustodian[i].sub(excess).toString()).to.equal(
          endingBalanceCustodian[i].toString()
        );

        const item = totals[i];
        expect(item.status).has.key("excessClaimed");
        expect(item.excess.toString()).to.equal(excess.toString());
      }
    });

    // TODO
    it("User Cannot Claim Allocations Again", async () => {
      const saleId = dummyConductor.getSaleId();
      const acceptedTokens = dummyConductor.acceptedTokens;
      const acceptedMints = acceptedTokens.map((token) => {
        return hexToPublicKey(token.address);
      });

      let caughtError = false;
      try {
        const tx = await contributor.claimAllocation(
          buyer,
          saleId,
          dummyConductor.getSaleTokenOnSolana(),
          acceptedMints
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });
  });

  describe("Conduct Aborted Sale", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      const allowOwnerOffCurve = true;
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        contributor.custodianAccount.key,
        allowOwnerOffCurve
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds
      const initSaleVaa = dummyConductor.createSale(
        startTime,
        duration,
        saleTokenAccount.address
      );
      const tx = await contributor.initSale(
        orchestrator,
        initSaleVaa,
        dummyConductor.getSaleTokenOnSolana()
      );

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        //expect(Uint8Array.from(saleState.tokenAddress)).to.deep.equal(Buffer.from(dummyConductor.tokenAddress, "hex"));
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.nativeTokenDecimals).to.equal(
          dummyConductor.nativeTokenDecimals
        );
        expect(saleState.times.start.toString()).to.equal(
          dummyConductor.saleStart.toString()
        );
        expect(saleState.times.end.toString()).to.equal(
          dummyConductor.saleEnd.toString()
        );
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(
          Buffer.from(dummyConductor.recipient, "hex")
        );
        expect(saleState.status).has.key("active");

        // check totals
        const totals: any = saleState.totals;
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(totals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = totals[i];
          const acceptedToken = dummyConductor.acceptedTokens[i];

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(
            tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)
          ).to.equal(acceptedToken.address);
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
      const contributedTokenIndices = [
        acceptedTokens[0].index,
        acceptedTokens[3].index,
      ];
      contributions.set(contributedTokenIndices[0], [
        "1200000000",
        "3400000000",
      ]);
      contributions.set(contributedTokenIndices[1], [
        "5600000000",
        "7800000000",
      ]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(
          amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr))
        );
      });

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions
          .get(tokenIndex)
          .map((value) => new BN(value))) {
          const tx = await contributor.contribute(
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
        }
      }
    });

    it("Orchestrator Aborts Sale with Signed VAA", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(
        await getBlockTime(connection)
      );
      const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);
        expect(saleState.status).has.key("aborted");
      }
    });

    it("Orchestrator Cannot Abort Sale Again", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(
        await getBlockTime(connection)
      );
      // cannot abort the sale again

      let caughtError = false;
      try {
        const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Claims Refund From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const acceptedTokens = dummyConductor.acceptedTokens;
      const acceptedMints = acceptedTokens.map((token) => {
        return hexToPublicKey(token.address);
      });

      const startingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
        })
      );

      const tx = await contributor.claimRefunds(buyer, saleId, acceptedMints);

      const endingBalanceBuyer = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedTokens.map(async (token) => {
          const mint = hexToPublicKey(token.address);
          return getPdaSplBalance(
            connection,
            mint,
            contributor.custodianAccount.key
          );
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
      const totals: any = buyerState.contributions;
      expect(totals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let refund = expectedRefundAmounts[i];

        expect(startingBalanceBuyer[i].add(refund).toString()).to.equal(
          endingBalanceBuyer[i].toString()
        );
        expect(startingBalanceCustodian[i].sub(refund).toString()).to.equal(
          endingBalanceCustodian[i].toString()
        );

        const item = totals[i];
        expect(item.status).has.key("refundClaimed");
        expect(item.excess.toString()).to.equal(refund.toString());
      }
    });

    it("User Cannot Claim Refund Again", async () => {
      const saleId = dummyConductor.getSaleId();
      const acceptedTokens = dummyConductor.acceptedTokens;
      const acceptedMints = acceptedTokens.map((token) => {
        return hexToPublicKey(token.address);
      });

      let caughtError = false;
      try {
        const tx = await contributor.claimRefunds(buyer, saleId, acceptedMints);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });
  });
});

async function waitUntilBlock(connection: web3.Connection, saleEnd: number) {
  let blockTime = await getBlockTime(connection);
  while (blockTime <= saleEnd) {
    await wait(1);
    blockTime = await getBlockTime(connection);
  }
}

function verifyErrorMsg(e: any, msg: string): boolean {
  if (e.msg) {
    const result = e.msg == msg;
    if (!result) {
      console.error(e);
    }
    return result;
  } else if (e.error) {
    const result = e.error.errorMessage == msg;
    if (!result) {
      console.error(e);
    }
    return result;
  }

  console.error(e);
  throw Error("unknown error");
}
