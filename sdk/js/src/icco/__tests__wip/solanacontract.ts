// Test vaas from Karl.
//first sale: successful
const initSaleVaa =
  "0100000000010096e02874d784b992173e54b27a29cf8d4d599e2229c03946e29801efd94fa82f4ea593459c8dde6fdf97fce5f450c47744ba7780c5262a2e88406e0dc4b513ba01000001170000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000000f01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000083752ecafebf4707258dedffbd9c7443148169db00020000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000000000000000011a000000000000000000000000000000000000000000000000000000000000015606000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000200000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c0002000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb140000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb14000000000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
//saleSealed vaa 0x01000000000100db9b30d6ea7eca3a68090ac1d494c188c75c4878e6c79e722d7b5b8b8b5ec4dd0f375eafa7aee0950f3f5976c6afb30ea7fe1f1ae5094571259d1b2cc2cd9ef900000001850000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000010f0300000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000047a09633e414a520100000000000000000000000000000000000000000000000002fc06415c6980000200000000000000000000000000000000000000000000000000729a89eca021080300000000000000000000000000000000000000000000000003bb07d1b383e0000400000000000000000000000000000000000000000000000000e53511bee2f000050000000000000000000000000000000000000000000000000157cf9cf2604c00

//second sale: aborted
//initSale vaa 0x01000000000100fdcba5d7965018ee9d02eb8cdedcd8dafa96f9be0ba5c3703701f725d38595bd290943517bca627f9805fe7dfef63e7f32ea073363c6ddd7832cee4aebda40f501000001c60000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000020f0100000000000000000000000000000000000000000000000000000000000000010000000000000000000000005f9d8f5c2648220bc45ba9eea6adb8c38920494300020000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e8000000000000000000000000000000000000000000000000000000000000000001c9000000000000000000000000000000000000000000000000000000000000020506000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000200000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c0002000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb140000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb14000000000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b
//saleAborted vaa 0x010000000001002a357b33c992d88135f19dad31f0f32b10ed670a50550f21c37026501a990c313d4fdb9cb60dee8e9b8a84dd94baa1a6bca8c472b12c1906f4fb321eb08b5819010000021e0000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000030f040000000000000000000000000000000000000000000000000000000000000001

import { describe, expect, jest, test, xtest } from "@jest/globals";
import {
  CHAIN_ID_BSC,
  CHAIN_ID_ETH,
  ixFromRust,
  setDefaultWasm,
  postVaaSolanaWithRetry,
} from "@certusone/wormhole-sdk";

import { sleepFor } from "../misc";

import {
  vaa_address,
  init_icco_sale_ix,
} from "../../solana/icco_contributor-node";

// Solana
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, Connection, PublicKey, Transaction } from "@solana/web3.js";

import { ethers } from "ethers";
// import { getContributorContractAsHexStringOnEth } from "../getters";
import {
  BSC_NODE_URL,
  ETH_NODE_URL,
  ETH_PRIVATE_KEY1,
  ETH_PRIVATE_KEY2,
  ETH_PRIVATE_KEY3,
  ETH_PRIVATE_KEY4,
  ETH_PRIVATE_KEY5,
  ETH_TOKEN_BRIDGE_ADDRESS,
  ETH_TOKEN_SALE_CONDUCTOR_ADDRESS,
  // ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS,
  //  TEST_ERC20,
  WBNB_ADDRESS,
  WETH_ADDRESS,
} from "../__tests__/consts";

//import { registerChainOnEth } from "../../../../../sdk/js/lib/cjs/icco/registerChain";
//import { registerChainOnEth } from "../../../";

import {
  createSaleOnEthAndGetVaa,
  EthBuyerConfig,
  EthContributorConfig,
  // createSaleOnEthAndInit,
  // waitForSaleToEnd,
  // waitForSaleToStart,
  makeAcceptedTokensFromConfigs,
  // sealOrAbortSaleOnEth,
  // contributeAllTokensOnEth,
  // secureContributeAllTokensOnEth,
  // getCollateralBalancesOnEth,
  // claimAllAllocationsOnEth,
  // getAllocationBalancesOnEth,
  // contributionsReconcile,
  // allocationsReconcile,
  // claimAllBuyerRefundsOnEth,
  // refundsReconcile,
  // prepareBuyersForMixedContributionTest,
  makeSaleStartFromLastBlock,
  // sealSaleAtContributors,
  // abortSaleAtContributors,
  // claimConductorRefund,
  // claimOneContributorRefundOnEth,
  // redeemCrossChainAllocations,
  // attestSaleToken,
  // getWrappedCollateral,
  // getRefundRecipientBalanceOnEth,
  // abortSaleEarlyAtContributors,
  // abortSaleEarlyAtConductor,
  deployTokenOnEth,
} from "../__tests__/helpers";
import { MsgInstantiateContract } from "@terra-money/terra.js";

setDefaultWasm("node");
//import { init_icco_sale_ix } from "icco_contributor";

const SOLANA_WALLET_PK =
  "14,173,153,4,176,224,201,111,32,237,183,185,159,247,22,161,89,84,215,209,212,137,10,92,157,49,29,192,101,164,152,70,87,65,8,174,214,157,175,126,98,90,54,24,100,177,247,77,19,112,47,44,165,109,233,102,14,86,109,29,134,145,132,141";
const SOLANA_CONTRIBUTOR_ADDR = "5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM";
const SOLANA_BRIDGE_ADDR = "Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o";

// ten minutes? nobody got time for that
jest.setTimeout(60000);

const solanaConnection = new Connection(
  "http://localhost:8899",
  "singleGossip"
);

describe("Solana dev Tests", () => {
  // This is just mock call into solana icco contract to pass hardcoded VAA. It won't pass ovnership test.
  xtest("call into init_icco_sale with hardcoded VAA", (done) => {
    (async () => {
      //      try {
      console.log("bbrp -->> hc init_icco_sale");

      // Wallet (payer) account decode
      const privateKeyDecoded = Uint8Array.from(
        SOLANA_WALLET_PK.split(",").map((s) => parseInt(s))
      );
      // console.log(privateKeyDecoded);
      const walletAccount = Keypair.fromSecretKey(privateKeyDecoded);
      console.log(walletAccount.publicKey.toString()); // check "6sbzC1eH4FTujJXWj51eQe25cYvr4xfXbJ1vAj7j2k5J"

      const saleInitVaa = Uint8Array.from(Buffer.from(initSaleVaa, "hex")); // Hardcoded!
      console.log("bbrp vaa len: ", saleInitVaa.length);

      // Log Solana VAA PDA address.
      const vaa_pda = vaa_address(SOLANA_BRIDGE_ADDR, saleInitVaa);
      const vaa_pda_pk = new PublicKey(vaa_pda);
      console.log("bbrp vaa PDA: ", vaa_pda_pk.toString());

      // Make init_icco_sale_ix.
      const ix = ixFromRust(
        init_icco_sale_ix(
          SOLANA_CONTRIBUTOR_ADDR,
          SOLANA_BRIDGE_ADDR,
          walletAccount.publicKey.toString(),
          saleInitVaa
        )
      );
      // call contributor contract
      const tx = new Transaction().add(ix);
      await solanaConnection.sendTransaction(tx, [walletAccount], {
        skipPreflight: false,
        preflightCommitment: "singleGossip",
      });

      // Done here.
      console.log("bbrp <<--- hc init_icco_sale");
      done();
      // } catch (e) {
      //   console.error(e);
      //   done("An error occurred in init_icco_sale contributor test");
      // }
    })();
  });

  test("call into init_icco_sale", (done) => {
    (async () => {
      try {
        console.log("bbrp -->> init_icco_sale");

        // create initSale using conductor on ETH.
        const ethProvider = new ethers.providers.WebSocketProvider(
          ETH_NODE_URL
        );
        const contributorConfigs: EthContributorConfig[] = [
          {
            chainId: CHAIN_ID_ETH,
            wallet: new ethers.Wallet(ETH_PRIVATE_KEY1, ethProvider),
            collateralAddress: WETH_ADDRESS,
            conversionRate: "1",
          },
          // TBD Need to add solana?
        ];
        const conductorConfig = contributorConfigs[0];
        // make sale token. mint 10 and sell 10%
        const tokenAddress = await deployTokenOnEth(
          ETH_NODE_URL,
          "Icco-Test",
          "ICCO",
          ethers.utils.parseUnits("10").toString(),
          conductorConfig.wallet
        );
        console.log("Token Address: ", tokenAddress);
        const buyers: EthBuyerConfig[] = [
          // native weth
          {
            chainId: CHAIN_ID_ETH,
            wallet: new ethers.Wallet(ETH_PRIVATE_KEY2, ethProvider),
            collateralAddress: WETH_ADDRESS,
            contribution: "6",
            tokenIndex: 0,
          },
        ];

        // we need to set up all of the accepted tokens (natives plus their wrapped versions)
        const acceptedTokens = await makeAcceptedTokensFromConfigs(
          contributorConfigs,
          buyers
        );

        const tokenAmount = "1";
        const minRaise = "10"; // eth units
        const maxRaise = "14";
        const saleDuration = 60; // seconds
        // get the time
        const saleStart = await makeSaleStartFromLastBlock(contributorConfigs);

        const decimals = 9;
        const saleEnd = saleStart + saleDuration;
        const saleInitVaa = await createSaleOnEthAndGetVaa(
          conductorConfig.wallet,
          conductorConfig.chainId,
          tokenAddress,
          ethers.utils.parseUnits(tokenAmount, decimals),
          ethers.utils.parseUnits(minRaise),
          ethers.utils.parseUnits(maxRaise),
          saleStart,
          saleEnd,
          acceptedTokens
        );
        console.info(
          "Sale Init VAA:",
          Buffer.from(saleInitVaa).toString("hex")
        );

        // Wallet (payer) account decode
        const privateKeyDecoded = Uint8Array.from(
          SOLANA_WALLET_PK.split(",").map((s) => parseInt(s))
        );
        // console.log(privateKeyDecoded);
        const walletAccount = Keypair.fromSecretKey(privateKeyDecoded);
        //  console.log(walletAccount.publicKey.toString()); // check "6sbzC1eH4FTujJXWj51eQe25cYvr4xfXbJ1vAj7j2k5J"

        // Log Solana VAA PDA address.
        const vaa_pda = vaa_address(SOLANA_BRIDGE_ADDR, saleInitVaa);
        const vaa_pda_pk = new PublicKey(vaa_pda);
        console.log("bbrp vaa PDA: ", vaa_pda_pk.toString());

        // post VAA on solana.
        await postVaaSolanaWithRetry(
          solanaConnection,
          async (transaction) => {
            transaction.partialSign(walletAccount);
            return transaction;
          },
          SOLANA_BRIDGE_ADDR,
          walletAccount.publicKey.toString(),
          Buffer.from(saleInitVaa),
          0
        );

        //        const saleInitVaa = Uint8Array.from(Buffer.from(initSaleVaa, "hex"));
        // console.log("bbrp vaa len: ", saleInitVaa.length);

        // Make init_icco_sale_ix.
        const ix = ixFromRust(
          init_icco_sale_ix(
            SOLANA_CONTRIBUTOR_ADDR,
            SOLANA_BRIDGE_ADDR,
            walletAccount.publicKey.toString(),
            saleInitVaa
          )
        );
        // call contributor contract
        const tx = new Transaction().add(ix);
        await solanaConnection.sendTransaction(tx, [walletAccount], {
          skipPreflight: false,
          preflightCommitment: "singleGossip",
        });

        // Done here.
        ethProvider.destroy();
        console.log("bbrp <<--- init_icco_sale");
        done();
      } catch (e) {
        console.error(e);
        done("An error occurred in init_icco_sale contributor test");
      }
    })();
  });
});
