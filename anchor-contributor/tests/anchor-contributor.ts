import { AnchorProvider, workspace, web3, Program, setProvider, BN } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import { CHAIN_ID_SOLANA, setDefaultWasm, tryHexToNativeString, tryNativeToHexString } from "@certusone/wormhole-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  createMint,
  getMint,
  mintTo,
  Account as AssociatedTokenAccount,
} from "@solana/spl-token";

import { DummyConductor, MAX_ACCEPTED_TOKENS } from "./helpers/conductor";
import { IccoContributor } from "./helpers/contributor";
import { getBlockTime, getSplBalance, hexToPublicKey, wait } from "./helpers/utils";

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

  // TODO: we need other wallets for buyers

  // dummy conductor to generate vaas
  const dummyConductor = new DummyConductor();

  // our contributor
  const contributor = new IccoContributor(program);

  before("Airdrop SOL", async () => {
    await connection.requestAirdrop(buyer.publicKey, 8000000000); // 8,000,000,000 lamports

    // TODO: consider taking this out?
    await wait(5);
  });

  describe("Test Preparation", () => {
    it("Create Dummy Sale Token", async () => {
      // mint 8 unique tokens
      const mint = await createMint(connection, orchestrator, orchestrator.publicKey, orchestrator.publicKey, 9);

      // we need to simulate attesting the sale token on Solana.
      // this allows us to "redeem" the sale token prior to sealing the sale
      // (which in the case of this test means minting it on the contributor program's ATA)
      await dummyConductor.attestSaleToken(connection, orchestrator);
    });

    it("Mint Accepted SPL Tokens to Buyer", async () => {
      // first create them and add them to the accepted tokens list
      const acceptedTokens = await dummyConductor.createAcceptedTokens(connection, orchestrator);

      for (const token of acceptedTokens) {
        const mint = new web3.PublicKey(tryHexToNativeString(token.address, CHAIN_ID_SOLANA));

        // create ata for buyer
        const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);

        // now mint to buyer for testing
        await mintTo(
          connection,
          orchestrator,
          mint,
          tokenAccount.address,
          orchestrator,
          20000000000n // 20,000,000,000 lamports
        );

        const balance = await getSplBalance(connection, mint, buyer.publicKey);
        expect(balance).to.equal(20000000000n);
      }
    });
  });

  describe("Sanity Checks", () => {
    /*
    it("Cannot Contribute to Non-Existent Sale", async () => {
      {
        const saleId = dummyConductor.getSaleId();
        const tokenIndex = 69;
        const amount = new BN("420"); // 420 lamports
        const mint = dummyConductor.acceptedTokens[tokenIndex].address;
        let caughtError = false;
        try {
          const tx = await contributor.contribute(orchestrator, saleId, tokenIndex, mint, amount);
        } catch (e) {
          caughtError = e.error.errorCode.code == "AccountNotInitialized";
        }

        if (!caughtError) {
          throw Error("did not catch expected error");
        }
      }
    });
    */
  });

  describe("Custodian Setup", () => {
    it("Create Custodian", async () => {
      const tx = await contributor.createCustodian(orchestrator);

      // get the custodian state
      const custodianState = await contributor.getCustodian();

      // verify
      expect(custodianState.owner.toString()).to.equal(orchestrator.publicKey.toString());
    });

    it("Create ATAs for Custodian", async () => {
      for (const token of dummyConductor.acceptedTokens) {
        const mint = new web3.PublicKey(tryHexToNativeString(token.address, CHAIN_ID_SOLANA));

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
    const contributions = new Map<web3.PublicKey, string[]>();
    const totalContributions: BN[] = [];

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        program.programId
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 10 + (await getBlockTime(connection));
      const duration = 5; // seconds
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address);
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        //expect(Uint8Array.from(saleState.tokenAddress)).to.deep.equal(Buffer.from(dummyConductor.tokenAddress, "hex"));
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(saleState.status).has.key("active");

        // check totals
        const totals: any = saleState.totals;
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

    it("Orchestrator Cannot Initialize Sale Again with Signed VAA", async () => {
      let caughtError = false;
      try {
        const tx = await contributor.initSale(orchestrator, dummyConductor.initSaleVaa);
      } catch (e) {
        // pda init should fail
        caughtError = "programErrorStack" in e;
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    /*

    it("User Cannot Contribute Too Early", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports
      const mint = dummyConductor.acceptedTokens[tokenIndex].address;

      let caughtError = false;
      try {
        const tx = await contributor.contribute(buyer, saleId, tokenIndex, mint, amount);
      } catch (e) {
        caughtError = e.error.errorCode.code == "ContributionTooEarly";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });
    */

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const blockTime = await getBlockTime(connection);
      const saleStart = dummyConductor.saleStart;
      if (blockTime <= saleStart) {
        console.log("waiting", saleStart - blockTime + 1, "seconds");
        await wait(saleStart - blockTime + 1);
      }

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      contributions.set(hexToPublicKey(acceptedTokens[0].address), ["1200000000", "3400000000"]);
      contributions.set(hexToPublicKey(acceptedTokens[3].address), ["5600000000", "7800000000"]);

      console.log("contributions", contributions);

      contributions.forEach((amounts) => {
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      const startingBalanceBuyer = await acceptedTokens.map(async (token) => {
        const mint = hexToPublicKey(token.address);
        return getSplBalance(connection, mint, buyer.publicKey);
      });
      const startingBalanceContributor = await acceptedTokens.map(async (token) => {
        const mint = hexToPublicKey(token.address);
        return getSplBalance(connection, mint, program.programId);
      });

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const [mint, contributionAmounts] of contributions) {
        for (const amount of contributionAmounts) {
          //const mint = dummyConductor.getAcceptedToken(tokenIndex).address;
          const tx = await contributor.contribute(buyer, saleId, mint, new BN(amount));
        }
      }

      const expectedContributedValues = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      /*

        // check buyer state
        {
          const buyerState = await contributor.getBuyer(saleId, orchestrator.publicKey);
          expect(buyerState.status).has.key("active");

          const contributed = buyerState.contributed;
          for (let i = 0; i < expectedContributedValues.length; ++i) {
            expect(contributed[i].toString()).to.equal(expectedContributedValues[i].toString());
          }
        }

        // check sale state
        {
          const saleState = await contributor.getSale(saleId);

          // check totals
          const totals: any = saleState.totals;

          for (let i = 0; i < expectedContributedValues.length; ++i) {
            const total = totals[i];
            expect(total.contributions.toString()).to.equal(expectedContributedValues[i].toString());
            expect(total.allocations.toString()).to.equal("0");
            expect(total.excessContributions.toString()).to.equal("0");
          }
        }
      */

      // TODO: check balances on contract and buyer
    });
    /*

    it("User Cannot Contribute to Non-Existent Token Index", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 1;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports
      const mint = dummyConductor.acceptedTokens[tokenIndex].address;

      let caughtError = false;
      try {
        const tx = await contributor.contribute(orchestrator, saleId, tokenIndex, mint, amount);
      } catch (e) {
        caughtError = e.error.errorCode.code == "InvalidTokenIndex";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    // TODO
    it("Orchestrator Cannot Attest Contributions Too Early", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("Orchestrator Attests Contributions", async () => {
      // wait for sale to end here
      const blockTime = await getBlockTime(connection);
      const saleEnd = dummyConductor.saleEnd;
      const saleId = dummyConductor.getSaleId();
      if (blockTime <= saleEnd) {
        await wait(saleEnd - blockTime + 1);
      }
      
      let caughtError = false;
      try {
        const tx = await contributor.attestContributions(orchestrator, saleId);
      } catch (e) {
        console.log(e);
      }

      // now go about your business
      expect(caughtError).to.be.false;
    });

    // TODO
    it("Orchestrator Cannot Attest Contributions Again", async () => {
      expect(false).to.be.true;
    });

    it("User Cannot Contribute After Sale Ended", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports
      const mint = dummyConductor.acceptedTokens[tokenIndex].address;

      let caughtError = false;
      try {
        const tx = await contributor.contribute(orchestrator, saleId, tokenIndex, mint, amount);
      } catch (e) {
        caughtError = e.error.errorCode.code == "SaleEnded";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    // TODO
    it("Orchestrator Seals Sale with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection));
      console.log("saleSealedVaa", saleSealedVaa.toString("hex"));
      const tx = await contributor.sealSale(orchestrator, saleSealedVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        // TODO: check totals
      }
    });

    // TODO
    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
      
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection));

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
      } catch (e) {
        //caughtError = e.error.errorCode.code == "SaleEnded";
        console.log(e.error.errorCode.code);
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    
      expect(false).to.be.true;
    });

    // TODO
    it("User Cannot Claim Allocations with Incorrect Token Index", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("User Claims Allocations From Sale", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("User Cannot Claim Allocations Again", async () => {
      expect(false).to.be.true;
    });
    */
  });

  /*
  describe("Conduct Aborted Sale", () => {
    // contributor info
    const contributions = new Map<number, string[]>();
    contributions.set(2, ["8700000000", "6500000000"]);
    contributions.set(8, ["4300000000", "2100000000"]);

    const totalContributions: BN[] = [];
    contributions.forEach((amounts) => {
      totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
    });

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        program.programId
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 10 + (await getBlockTime(connection));
      const duration = 5; // seconds
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address);
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        //expect(Uint8Array.from(saleState.tokenAddress)).to.deep.equal(Buffer.from(dummyConductor.tokenAddress, "hex"));
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(saleState.status).has.key("active");

        // check totals
        const totals: any = saleState.totals;
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
      const blockTime = await getBlockTime(connection);
      const saleStart = dummyConductor.saleStart;
      if (blockTime <= saleStart) {
        await wait(saleStart - blockTime + 1);
      }

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const [tokenIndex, contributionAmounts] of contributions) {
        for (const amount of contributionAmounts) {
          const mint = dummyConductor.acceptedTokens[tokenIndex].address;
          const tx = await contributor.contribute(orchestrator, saleId, tokenIndex, mint, new BN(amount));
        }
      }
    });

    it("Orchestrator Aborts Sale with Signed VAA", async () => {
      // TODO: need to abort sale
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
      } catch (e) {
        caughtError = e.error.errorCode.code == "SaleEnded";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    // TODO
    it("User Cannot Claim Refund with Incorrect Token Index", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("User Claims Refund From Sale", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("User Cannot Claim Refund Again", async () => {
      expect(false).to.be.true;
    });
  });
  */
});
