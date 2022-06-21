import { web3 } from "@project-serum/anchor";
import {
  createMint,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import {
  AVAX_CORE_BRIDGE_ADDRESS,
  AVAX_TOKEN_BRIDGE_ADDRESS,
  KYC_AUTHORITY,
  KYC_AUTHORITY_KEY,
  REPO_PATH,
  SDK_PATH,
  SOLANA_CORE_BRIDGE_ADDRESS,
  SOLANA_TOKEN_BRIDGE_ADDRESS,
  WORMHOLE_RPCS,
} from "./consts";
import { connectToContributorProgram } from "./solana";
import { getPdaAssociatedTokenAddress, wait } from "../anchor/utils";
import { readJson } from "./io";
import { IccoContributor as SolanaContributor } from "../anchor/contributor";
import {
  attestFromSolana,
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
  CHAIN_ID_TERRA,
  createWrappedOnEth,
  getForeignAssetEth,
  getIsWrappedAssetEth,
  getOriginalAssetEth,
  getSignedVAAWithRetry,
  parseSequenceFromLogSolana,
  parseSequencesFromLogSolana,
  postVaaSolanaWithRetry,
  redeemOnEth,
  setDefaultWasm,
  transferFromSolana,
  tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { AcceptedToken, Raise } from "../icco";
import { Purse } from "./purse";
import {
  attestMintFromSolana,
  getCurrentTime,
  getSignedVaaFromSolanaTokenBridge,
  transferFromSolanaToEvm,
} from "./utils";
import { SaleParams } from "./structs";
import { ERC20__factory } from "../ethers-contracts";
import { IccoConductor as EvmConductor } from "../evm/conductor";
import { SaleParameters } from "../utils";
import { ethers } from "ethers";
setDefaultWasm("node");

describe("Testnet ICCO Sales", () => {
  // warehouse wallets from various chains
  if (!process.env.TESTNET_WALLETS) {
    throw Error("TESTNET_WALLETS not found in environment");
  }
  const purse = new Purse(process.env.TESTNET_WALLETS);

  // establish orchestrator's wallet
  const avaxOrchestrator = purse.getEvmWallet(CHAIN_ID_AVAX, 0);
  const solanaOrchestrator = purse.getSolanaWallet(0);

  // and buyers
  const buyers = [purse.getSolanaWallet(1), purse.getSolanaWallet(2)];

  // providers
  const avaxConnection = purse.avax.provider;
  //const solanaConnection = program.provider.connection;
  const solanaConnection = purse.solana.provider;

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

  //   describe("Prepration", () => {
  //     it("Airdrop SOL", async () => {
  //       console.log("requestAirdrop");
  //       await solanaConnection.requestAirdrop(solanaOrchestrator.publicKey, 2_000_000_000); // lamports
  //       await wait(5);

  //       /*
  //       for (const buyer of buyers) {
  //         await solanaConnection.requestAirdrop(buyer.publicKey, 2_000_000_000); // lamports
  //         await wait(5);
  //       }
  //       */

  //       // do we need to wait for the airdrop to hit a wallet?
  //       //await wait(5);
  //     });
  //   });

  describe("Conduct Successful Sale", () => {
    const parameters = new SaleParameters(conductorChain);

    it("Prepare Sale Parameters (Token Originating from Solana)", async () => {
      // create and mint to orchestrator
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
        10_000_000_000
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
          1_000_000_000n, // 10% of tokens
          CHAIN_ID_AVAX,
          avaxOrchestrator.address
        );
        const sequence = parseSequenceFromLogSolana(response);
        console.log(`transferFromSolanaToEvm, sequence=${sequence}`);

        const signedVaa = await getSignedVaaFromSolanaTokenBridge(sequence);
        const avaxTx = await redeemOnEth(AVAX_TOKEN_BRIDGE_ADDRESS, avaxOrchestrator, signedVaa);
        console.log(`avaxTx: ${avaxTx.transactionHash}`);
      }

      {
        const saleTokenAddress = await getForeignAssetEth(
          AVAX_TOKEN_BRIDGE_ADDRESS,
          avaxConnection,
          CHAIN_ID_SOLANA,
          tryNativeToUint8Array(saleTokenMint.toString(), CHAIN_ID_SOLANA)
        );
        console.log("saleTokenAddress", saleTokenAddress);

        const saleToken = ERC20__factory.connect(saleTokenAddress, avaxOrchestrator);
        const balance = await saleToken.balanceOf(avaxOrchestrator.address);
        expect(balance.toString()).to.equal("1000000000");

        const mintInfo = await getMint(solanaConnection, saleTokenMint);

        const custodianSaleTokenAccount = await getOrCreateAssociatedTokenAccount(
          solanaConnection,
          solanaOrchestrator,
          saleTokenMint,
          solanaContributor.custodian,
          true // allowOwnerOffCurve
        );
        console.log("custodianSaleTokenAccount", custodianSaleTokenAccount.address.toString());

        // we want everything denominated in uusd for this test
        const denominationNativeAddress = "uusd";
        const denominationDecimals = await (async () => {
          const wrapped = await getForeignAssetEth(
            AVAX_TOKEN_BRIDGE_ADDRESS,
            avaxConnection,
            CHAIN_ID_TERRA,
            tryNativeToUint8Array(denominationNativeAddress, CHAIN_ID_TERRA)
          );

          const token = ERC20__factory.connect(wrapped, avaxConnection);
          return token.decimals();
        })();

        const minRaise = "1"; // uusd
        const maxRaise = "20"; // uusd

        parameters.makeRaise(
          true, // fixed price sale == true
          saleTokenMint.toString(),
          CHAIN_ID_SOLANA,
          balance.toString(),
          avaxOrchestrator.address,
          avaxOrchestrator.address,
          45, // delay of when to start sale
          180, // duration of sale
          45, // unlock period after sale ends
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

    it("Prepare Accepted Tokens", async () => {
    const mints: web3.PublicKey[] = [];

    const numSolanaAccepted = 2;

    for (let i = 0; i < numSolanaAccepted; ++i) {
      const mint = await createMint(
        solanaConnection,
        solanaOrchestrator,
        solanaOrchestrator.publicKey,
        solanaOrchestrator.publicKey,
        9
      );
      console.log(`created accepted token: ${mint.toString()}`);

      for (const buyer of buyers) {
        const tokenAccount = await getOrCreateAssociatedTokenAccount(solanaConnection, buyer, mint, buyer.publicKey);
        await mintTo(solanaConnection, buyer, mint, tokenAccount.address, buyer.publicKey, 1_000_000_000);
      }
      mints.push(mint);
    }

    // bridge last numAccepted - numSolanaAccepted over to AVAX
    //const bridgedMints = mints.slice(numSolanaAccepted);

    const acceptedTokens: any = [
      {
        chainId: 1,
        address: "5Dmmc5CC6ZpKif8iN5DSY9qNYrWJvEKcX2JrxGESqRMu",
        conversionRate: "1",
      },
      {
        chainId: 1,
        address: "3Ftc5hTz9sG4huk79onufGiebJNDMZNL8HYgdMJ9E7JR",
        conversionRate: "1",
      },
    ];
    */
    });

    it("Create Sale", async () => {
      const avaxTx = await conductor.createSale(parameters.raise, parameters.acceptedTokens);
      console.log("avaxTx", avaxTx.transactionHash);
    });
  });
});
