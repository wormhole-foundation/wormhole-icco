import { AnchorProvider, workspace, web3, Program, setProvider, BN } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import { CHAIN_ID_SOLANA, setDefaultWasm, tryHexToNativeString, tryNativeToHexString } from "@certusone/wormhole-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
  Account as AssociatedTokenAccount,
} from "@solana/spl-token";

import { DummyConductor, MAX_ACCEPTED_TOKENS } from "./helpers/conductor";
import { IccoContributor } from "./helpers/contributor";
import { getBlockTime, getPdaSplBalance, getSplBalance, hexToPublicKey, wait } from "./helpers/utils";

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

  /*
  describe("Sanity Checks", () => {
    it("Cannot Contribute to Non-Existent Sale", async () => {
      {
        const saleId = dummyConductor.getSaleId();
        const tokenIndex = 69;
        const amount = new BN("420"); // 420 lamports
        let caughtError = false;
        try {
        const mint = hexToPublicKey(dummyConductor.acceptedTokens[0].address);
        const tx = await contributor.contribute(buyer, saleId, mint, new BN(amount));
        } catch (e) {
          caughtError = e.error.errorCode.code == "AccountNotInitialized";
        }

        if (!caughtError) {
          throw Error("did not catch expected error");
        }
      }
    });
  });
  */

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
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address);
      const tx = await contributor.initSale(orchestrator, initSaleVaa, dummyConductor.getSaleTokenOnSolana());

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
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const mint = hexToPublicKey(dummyConductor.acceptedTokens[0].address);
        const tx = await contributor.contribute(buyer, saleId, mint, new BN(amount));
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "ContributionTooEarly");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokens = [hexToPublicKey(acceptedTokens[0].address), hexToPublicKey(acceptedTokens[3].address)];
      contributions.set(contributedTokens[0], ["1200000000", "3400000000"]);
      contributions.set(contributedTokens[1], ["5600000000", "7800000000"]);

      contributedTokens.forEach((mint) => {
        const amounts = contributions.get(mint);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
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
          return getPdaSplBalance(connection, mint, contributor.custodianAccount.key);
        })
      );

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const mint of contributedTokens) {
        for (const amount of contributions.get(mint)) {
          const tx = await contributor.contribute(buyer, saleId, mint, new BN(amount));
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
          return getPdaSplBalance(connection, mint, contributor.custodianAccount.key);
        })
      );

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
      const numExpected = expectedContributedValues.length;
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const totals = buyerState.contributions;

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let contribution = expectedContributedValues[i];
        expect(startingBalanceBuyer[i].sub(contribution).toString()).to.equal(endingBalanceBuyer[i].toString());
        expect(startingBalanceCustodian[i].add(contribution).toString()).to.equal(endingBalanceCustodian[i].toString());

        let item = totals[i];
        const expectedState = contribution.eq(new BN("0")) ? "inactive" : "active";
        expect(item.status).has.key(expectedState);
        expect(item.amount.toString()).to.equal(expectedContributedValues[i].toString());
        expect(item.excess.toString()).to.equal("0");
      }

      // check sale state
      {
        const saleState = await contributor.getSale(saleId);
        const totals: any = saleState.totals;

        for (let i = 0; i < expectedContributedValues.length; ++i) {
          const total = totals[i];
          expect(total.contributions.toString()).to.equal(expectedContributedValues[i].toString());
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    // TODO
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

    // TODO
    it("Orchestrator Attests Contributions", async () => {
      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      const saleId = dummyConductor.getSaleId();
      await waitUntilBlock(connection, saleEnd);
      const tx = await contributor.attestContributions(orchestrator, saleId);

      // now go about your business
      //expect(caughtError).to.be.false;
    });

    it("User Cannot Contribute After Sale Ended", async () => {
      const saleId = dummyConductor.getSaleId();
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const mint = hexToPublicKey(dummyConductor.acceptedTokens[0].address);
        const tx = await contributor.contribute(buyer, saleId, mint, amount);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    // TODO
    it("Orchestrator Seals Sale with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection));
      //console.log("saleSealedVaa", saleSealedVaa.toString("hex"));
      const tx = await contributor.sealSale(orchestrator, saleSealedVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        // TODO: check totals
        expect(false).to.be.true;
      }
    });

    it("Orchestrator cranks send contributions", async () => {
      expect(true).to.be.true;
    });

    // TODO
    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection));

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
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
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address);
      const tx = await contributor.initSale(orchestrator, initSaleVaa, dummyConductor.getSaleTokenOnSolana());

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        //expect(Uint8Array.from(saleState.tokenAddress)).to.deep.equal(Buffer.from(dummyConductor.tokenAddress, "hex"));
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.nativeTokenDecimals).to.equal(dummyConductor.nativeTokenDecimals);
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
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokens = [hexToPublicKey(acceptedTokens[0].address), hexToPublicKey(acceptedTokens[3].address)];
      contributions.set(contributedTokens[0], ["1200000000", "3400000000"]);
      contributions.set(contributedTokens[1], ["5600000000", "7800000000"]);

      contributedTokens.forEach((mint) => {
        const amounts = contributions.get(mint);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const mint of contributedTokens) {
        for (const amount of contributions.get(mint)) {
          const tx = await contributor.contribute(buyer, saleId, mint, new BN(amount));
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
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    // TODO
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
          return getPdaSplBalance(connection, mint, contributor.custodianAccount.key);
        })
      );

      // const validClaimIndices = [0, 3];
      // for (let i = 0; i < acceptedMints.length; ++i) {
      //   let valid = validClaimIndices.indexOf(i) >= 0;
      //   let mint = acceptedMints[i];

      //   // if we have something to claim, we should get a successful transaction.
      //   // if not, we will get an error saying there is nothing to claim
      //   if (valid) {
      //     const tx = await contributor.claimRefund(buyer, saleId, mint);
      //   } else {
      //     let caughtError = false;
      //     try {
      //       const tx = await contributor.claimRefund(buyer, saleId, mint);
      //       throw Error(`should not happen: ${i}, ${tx}`);
      //     } catch (e) {
      //       caughtError = verifyErrorMsg(e, "NothingToClaim");
      //     }

      //     if (!caughtError) {
      //       throw Error("did not catch expected error");
      //     }
      //   }
      // }

      // uncomment this if you like to play with fire
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
          return getPdaSplBalance(connection, mint, contributor.custodianAccount.key);
        })
      );

      const expectedRefundValues = [
        totalContributions[0],
        new BN(0),
        new BN(0),
        totalContributions[1],
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedRefundValues.length;

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const totals: any = buyerState.contributions;
      console.log("buyerState -- ", buyerState);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let refund = expectedRefundValues[i];

        expect(startingBalanceBuyer[i].add(refund).toString()).to.equal(endingBalanceBuyer[i].toString());
        expect(startingBalanceCustodian[i].sub(refund).toString()).to.equal(endingBalanceCustodian[i].toString());

        const item = totals[i];
        console.log("i, item -- ", i, item.status, "  ", item.excess.toString(), "  ", refund.toString());

        const expectedState = refund.eq(new BN("0")) ? "inactive" : "refundClaimed";
        //        expect(item.status).has.key(expectedState);
        //        expect(item.excess.toString()).to.equal(refund.toString());
      }
    });

    it("User Cannot Claim Refund Again", async () => {
      // TODO
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
