import { AnchorProvider, workspace, web3, Program, setProvider } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import { CHAIN_ID_SOLANA, setDefaultWasm, tryHexToNativeString, tryNativeToHexString } from "@certusone/wormhole-sdk";
import { createAssociatedTokenAccount } from "@solana/spl-token";

import { DummyConductor } from "./helpers/conductor";
import { CONDUCTOR_ADDRESS, CONDUCTOR_CHAIN } from "./helpers/consts";
import { IccoContributor } from "./helpers/contributor";
import { getBlockTime, wait } from "./helpers/utils";
import { BN } from "bn.js";

setDefaultWasm("node");

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  setProvider(AnchorProvider.env());

  const program = workspace.AnchorContributor as Program<AnchorContributor>;
  const connection = program.provider.connection;

  const owner = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./tests/test_keypair.json").toString()))
  );

  // TODO: we need other wallets for buyers

  // dummy conductor to generate vaas
  const dummyConductor = new DummyConductor();

  // our contributor
  const contributor = new IccoContributor(program);

  describe("Token Custodian", () => {
    it("Create Token Custodian", async () => {
      await contributor.createTokenCustodian(owner);

      // get the contributor state
      const tokenCustodianState = await contributor.getTokenCustodian();

      // verify
      expect(tokenCustodianState.owner.toString()).to.equal(owner.publicKey.toString());
    });
  });

  describe("Sanity Checks", () => {
    it("Cannot Contribute to Non-Existent Sale", async () => {
      {
        const saleId = dummyConductor.getSaleId();
        const tokenIndex = 69;
        const amount = new BN("420"); // 420 lamports

        let caughtError = false;
        try {
          const tx = await contributor.contribute(owner, saleId, tokenIndex, amount);
        } catch (e) {
          caughtError = e.error.errorCode.code == "AccountNotInitialized";
        }

        if (!caughtError) {
          throw Error("did not catch expected error");
        }
      }
    });
  });

  describe("Conduct Successful Sale", () => {
    // contributor info
    const contributionTokenIndex = 2;
    const contributionAmounts = ["2000000000", "3000000000"];
    const totalContributionAmount = contributionAmounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr));


    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const tokenAccountKey = tryHexToNativeString(
        "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db",
        CHAIN_ID_SOLANA
      ); // placeholder

      const duration = 5; // seconds
      const initSaleVaa = dummyConductor.createSale(
        await getBlockTime(connection),
        duration,
        new web3.PublicKey(tokenAccountKey)
      );
      const tx = await contributor.initSale(owner, initSaleVaa);

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
        const tx = await contributor.initSale(owner, dummyConductor.initSaleVaa);
      } catch (e) {
        // pda init should fail
        caughtError = "programErrorStack" in e;
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Create Associated Token Accounts for Token Custodian", async () => {
        // TODO: need to do sale token, too

        const tokens = dummyConductor.acceptedTokens.map((token) => {
            return tryHexToNativeString(token.address, CHAIN_ID_SOLANA)
        });
    
        /*
        for(let addr of tokens) {
          await createAssociatedTokenAccount(connection, owner, addr, program.programId);
        }
        */
        
    });

    it("User Cannot Contribute Too Early", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(owner, saleId, tokenIndex, amount);
      } catch (e) {
        caughtError = e.error.errorCode.code == "ContributionTooEarly";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }

      // TODO: check balances on contract and buyer
    });

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const blockTime = await getBlockTime(connection);
      const saleStart = dummyConductor.saleStart;
      if (blockTime <= saleStart) {
        await wait(saleStart - blockTime + 1);
      }

      // now go about your business

      // contribute twice
      const saleId = dummyConductor.getSaleId();
      for (const amount of contributionAmounts) {
        const tx = await contributor.contribute(owner, saleId, contributionTokenIndex, new BN(amount));
      }

      // check buyer state
      {
        const saleId = dummyConductor.getSaleId();
        const buyerState = await contributor.getBuyer(saleId, owner.publicKey);
        expect(buyerState.status).has.key("active");

        const expectedContributedValues = [
          totalContributionAmount,
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
          new BN(0),
        ];
        const contributed = buyerState.contributed;
        expect(contributed.length).to.equal(10);
        for (let i = 0; i < 10; ++i) {
          expect(contributed[i].toString()).to.equal(expectedContributedValues[i].toString());
        }
      }

      // TODO: check balances on contract and buyer
    });

    it("User Cannot Contribute to Non-Existent Token Index", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 1;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(owner, saleId, tokenIndex, amount);
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
      if (blockTime <= saleEnd) {
        await wait(saleEnd - blockTime + 1);
      }

      // now go about your business
      expect(false).to.be.true;
    });

    // TODO
    it("Orchestrator Cannot Attest Contributions Again", async () => {
      expect(false).to.be.true;
    });

    it("User Cannot Contribute After Sale Ended", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(owner, saleId, tokenIndex, amount);
      } catch (e) {
        caughtError = e.error.errorCode.code == "SaleEnded";
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
      // check buyer state
      {
        const saleId = dummyConductor.getSaleId();
        //const buyerState = await contributor.getBuyer(saleId, owner.publicKey);
      }

      // TODO: check balances on contract and buyer
    });

    // TODO
    it("Orchestrator Seals Sale with Signed VAA", async () => {
      expect(false).to.be.true;
    });

    // TODO
    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
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
  });

  describe("Conduct Aborted Sale", () => {
    // contributor info
    const contributionTokenIndex = 2;
    const contributionAmounts = ["2000000000", "3000000000"];
    const totalContributionAmount = contributionAmounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr));

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      // set up saleInit vaa
      const tokenAccountKey = tryHexToNativeString(
        "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db",
        CHAIN_ID_SOLANA
      ); // placeholder

      const duration = 5; // seconds
      const initSaleVaa = dummyConductor.createSale(
        await getBlockTime(connection),
        duration,
        new web3.PublicKey(tokenAccountKey)
      );
      const tx = await contributor.initSale(owner, initSaleVaa);

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
      const saleId = dummyConductor.getSaleId();
      for (const amount of contributionAmounts) {
        const tx = await contributor.contribute(owner, saleId, contributionTokenIndex, new BN(amount));
      }
    });

    it("Orchestrator Aborts Sale with Signed VAA", async () => {
      // TODO: need to abort sale
      const saleAbortedVaa = dummyConductor.abortSale(await getBlockTime(connection));
      const tx = await contributor.abortSale(owner, saleAbortedVaa);

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
        const tx = await contributor.abortSale(owner, saleAbortedVaa);
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
  /*

    it("creates custody accounts for given token", async () => {
    setDefaultWasm("node");
    const { parse_vaa } = await importCoreWasm();
    const parsedVaa = parse_vaa(initSaleVaa);

    const parsedPayload = await parseSaleInit(parsedVaa.payload);
    console.log(parsedPayload);

    //Iterate through all accepted tokens on Solana
    let solanaTokenAddresses = [];

    for(let addr of solanaTokenAddresses) {
      await createAssociatedTokenAccount(connection, owner, addr, program.programId);
    }
    });
    */
});
  