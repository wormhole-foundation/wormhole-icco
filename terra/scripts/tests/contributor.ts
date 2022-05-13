import { BlockTxBroadcastResult, Coin, Coins, Int, LCDClient, Wallet } from "@terra-money/terra.js";
import { nativeToHexString, CHAIN_ID_TERRA } from "@certusone/wormhole-sdk";

import { WORMHOLE_ADDRESSES } from "../consts";
import {
  instantiateContract,
  executeContract,
  uploadContract,
  queryContract,
  sleep,
} from "../helpers";

import {
  CONDUCTOR_CHAIN,
  CONDUCTOR_ADDRESS,
  AcceptedToken,
  encodeSaleInit,
  getBlockTime,
  signAndEncodeConductorVaa,
  getErrorMessage,
  getBalance,
  makeClientAndWallets,
  getBuyerStatus,
  getTotalContribution,
  encodeSaleAborted,
} from "./lib";

const contracts = new Map<string, string>();

async function main() {
  // real test here
  //const { terra, wallet } = newLocalClient();
  const [terra, actors] = makeClientAndWallets();

  console.log("-------- Preparation --------\n");
  await mintCw20(terra, actors.owner, actors.buyers);
  console.log();

  console.log("-------- Deployment --------\n");
  await deployment(terra, actors.owner, actors.seller);
  console.log();

  console.log("-------- Conduct Successful Sale --------\n");
  await conductSuccessfulSale(terra, actors.seller, actors.buyers);
  console.log();

  console.log("-------- Conduct Aborted Sale --------\n");
  await conductAbortedSale(terra, actors.seller, actors.buyers);
  console.log();
  return;
}

async function mintCw20(terra: LCDClient, owner: Wallet, buyers: Wallet[]): Promise<void> {
  const mintAmount = "1000000000000"; // 1,000,000.000000

  {
    logTestName("1. Mint CW20 Test token");

    const cw20CodeId = 4; // cw20_base (from wormhole contract deployments)
    const msg: any = {
      name: "Definitely Worth Something",
      symbol: "WORTH",
      decimals: 6,
      initial_balances: [
        {
          address: owner.key.accAddress,
          amount: mintAmount,
        },
        {
          address: buyers[0].key.accAddress,
          amount: mintAmount,
        },
        {
          address: buyers[1].key.accAddress,
          amount: mintAmount,
        },
      ],
      mint: null,
    };
    const mockToken = await instantiateContract(
      terra,
      owner,
      owner.key.accAddress,
      cw20CodeId,
      msg
    );
    contracts.set("mockToken", mockToken);
    logAddr("mockToken", mockToken);

    // done
    success();
  }

  {
    logTestName("2. Query Balance of Mock Token");

    const mockToken = contracts.get("mockToken");
    if (mockToken === undefined) {
      throw Error("mock token not minted");
    }

    for (const wallet of [owner, buyers[0], buyers[1]]) {
      const msg: any = {
        balance: {
          address: wallet.key.accAddress,
        },
      };
      const result = await queryContract(terra, mockToken, msg);
      if (result.balance !== mintAmount) {
        return failMessage("result.balance !== mintAmount");
      }
    }

    success();
  }

  // done
  return;
}

async function deployment(terra: LCDClient, owner: Wallet, another: Wallet): Promise<void> {
  {
    logTestName("1. Deploy Contract");
    const addresses = WORMHOLE_ADDRESSES.localterra;

    const codeId = await uploadContract(terra, owner, "../artifacts/icco_contributor.wasm");

    const msg: any = {
      wormhole: addresses.wormhole,
      token_bridge: addresses.tokenBridge,
      conductor_chain: CONDUCTOR_CHAIN,
      conductor_address: Buffer.from(CONDUCTOR_ADDRESS, "hex").toString("base64"),
    };
    const contributor = await instantiateContract(terra, owner, owner.key.accAddress, codeId, msg);
    contracts.set("contributor", contributor);
    logAddr("contributor", contributor);

    // done
    success();
  }

  {
    logTestName("2. Non-Owner Cannot Upgrade Contract");
    untested();
  }

  {
    logTestName("3. Upgrade Contract");
    untested();
  }

  // done
  return;
}

async function conductSuccessfulSale(
  terra: LCDClient,
  seller: Wallet,
  buyers: Wallet[]
): Promise<void> {
  // get mock token
  const mockToken = contracts.get("mockToken");
  if (mockToken === undefined) {
    throw Error("mock token not minted yet");
  }

  // get deployed address
  const contributor = contracts.get("contributor");
  if (contributor === undefined) {
    throw Error("contributor not deployed yet");
  }

  // set up saleInit vaa
  const saleId = 1;
  const tokenAddress = "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db";
  const tokenChain = 2;
  const tokenAmount = "1000000000000000000";
  const minRaise = "10000000000000000000";
  const maxRaise = "14000000000000000000";

  // set up sale time based on block time
  const blockTime = await getBlockTime(terra);
  const saleStart = blockTime + 5;
  const saleEnd = blockTime + 35;

  const acceptedTokens: AcceptedToken[] = [
    {
      address: nativeToHexString("uluna", CHAIN_ID_TERRA)!,
      chain: 3,
      conversionRate: "1000000000000000000",
    },
    {
      address: nativeToHexString(mockToken, CHAIN_ID_TERRA)!,
      chain: 3,
      conversionRate: "200000000000000000",
    },
  ];

  const recipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
  const refundRecipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";

  // save state
  const sale: any = {};

  {
    logTestName(" 1. Orchestrator Initializes Sale... ");
    // Conductor will have produced a VAA. Here we fabricate the VAA and
    // forge a signature with devnet guardian
    const data = encodeSaleInit(
      saleId,
      tokenAddress,
      tokenChain,
      tokenAmount,
      minRaise,
      maxRaise,
      saleStart,
      saleEnd,
      acceptedTokens,
      recipient,
      refundRecipient
    );

    // save the sale id and sale end time
    sale.saleId = data.subarray(1, 33);
    sale.saleEnd = saleEnd;

    const timestamp = 1;
    const nonce = 0;
    const sequence = 3;

    const signedVaa = signAndEncodeConductorVaa(timestamp, nonce, sequence, data);
    sale.saleInitVaa = signedVaa;

    try {
      // ExecuteMsg::InitSale { signed_vaa }
      const msg: any = {
        init_sale: {
          signed_vaa: signedVaa.toString("base64"),
        },
      };

      const receipt = await executeContract(
        //terra,
        seller,
        contributor,
        msg
      );
      logTx("InitSale", receipt);
    } catch (e: any) {
      return fail(e);
    }

    // done
    success();
  }

  {
    logTestName(" 2. Orchestrator Cannot Intialize Sale Again");
    const signedVaa = sale.saleInitVaa;

    let failed = false;
    try {
      // ExecuteMsg::InitSale { signed_vaa }
      const msg: any = {
        init_sale: {
          signed_vaa: signedVaa.toString("base64"),
        },
      };

      const receipt = await executeContract(
        //terra,
        seller,
        contributor,
        msg
      );
      logTx("InitSale", receipt);
      failed = receipt.raw_log.includes("SaleAlreadyExists");
    } catch (e: any) {
      failed = getErrorMessage(e).includes("SaleAlreadyExists");
    }

    if (!failed) {
      return successUnexpected();
    }

    // done
    success();
  }

  {
    logTestName(" 3. User Contributes to Sale (Native)");

    const denom = "uluna";
    const contributorBalanceBefore = await getBalance(terra, denom, contributor);
    const walletBalanceBefore = await getBalance(terra, denom, buyers[0].key.accAddress);

    const tokenIndex = 0;
    const amounts = ["1000000", "2000000"];
    const totalAmount = amounts
      .map((x: string) => new Int(x)!)
      .reduce((x: Int, y: Int) => x.add(y) as Int)
      .toString();

    // save to verify attest contribution
    sale.denomTotalAmount = totalAmount;

    // contribute twice
    try {
      for (const amount of amounts) {
        // ExecuteMsg::Contribute { sale_id, token_index, amount }
        const msg: any = {
          contribute: {
            sale_id: sale.saleId.toString("base64"),
            token_index: tokenIndex,
            amount,
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          contributor,
          msg,
          new Coins([new Coin(denom, amount)])
        );
        logTx("Contribute", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // double-check native balance
    {
      const contributorBalance = await getBalance(terra, denom, contributor);
      if (
        contributorBalance.lte(contributorBalanceBefore) ||
        !contributorBalance.sub(contributorBalanceBefore).equals(totalAmount)
      ) {
        return failMessage("contributor balance change !== totalAmount");
      }

      const walletBalance = await getBalance(terra, denom, buyers[0].key.accAddress);
      if (
        walletBalance.gte(walletBalanceBefore) ||
        !walletBalanceBefore.sub(walletBalance).equals(totalAmount)
      ) {
        return failMessage("wallet balance change !== totalAmount");
      }
    }

    // query buyer's contribution
    {
      const status = await getBuyerStatus(
        terra,
        contributor,
        sale.saleId,
        tokenIndex,
        buyers[0].key.accAddress
      );
      if (!status.active || status.active.contribution != totalAmount) {
        return failMessage(`wrong buyer status: ${status}`);
      }
    }

    // query total contributions
    {
      const totalContribution = await getTotalContribution(
        terra,
        contributor,
        sale.saleId,
        tokenIndex
      );
      if (!totalContribution.equals(totalAmount)) {
        return failMessage(`wrong total contribution: ${totalContribution} vs ${totalAmount}`);
      }
    }

    // done
    success();
  }

  {
    logTestName(" 4. User Contributes to Sale (CW20)");

    const contributorBalanceBefore = await getBalance(terra, mockToken, contributor);
    const walletBalanceBefore = await getBalance(terra, mockToken, buyers[0].key.accAddress);

    const tokenIndex = 1;
    const amounts = ["2000000", "3000000"];
    const totalAmount = amounts
      .map((x: string) => new Int(x)!)
      .reduce((x: Int, y: Int) => x.add(y) as Int)
      .toString();

    // save to verify attest contribution
    sale.tokenTotalAmount = totalAmount;

    // set allowance for total
    try {
      {
        const msg: any = {
          increase_allowance: {
            spender: contributor,
            amount: totalAmount,
            expires: {
              never: {},
            },
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          mockToken,
          msg
        );
        logTx("IncreaseAllowance", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // contribute twice
    try {
      for (const amount of amounts) {
        // ExecuteMsg::Contribute { sale_id, token_index, amount }
        const msg = {
          contribute: {
            sale_id: sale.saleId.toString("base64"),
            token_index: tokenIndex,
            amount,
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          contributor,
          msg
        );
        logTx("Contribute", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // double-check cw20 balance on wallet and contract
    {
      const contributorBalance = await getBalance(terra, mockToken, contributor);
      if (
        contributorBalance.lte(contributorBalanceBefore) ||
        !contributorBalance.sub(contributorBalanceBefore).equals(totalAmount)
      ) {
        return failMessage("contributor balance change !== totalAmount");
      }

      const walletBalance = await getBalance(terra, mockToken, buyers[0].key.accAddress);
      if (
        walletBalance.gte(walletBalanceBefore) ||
        !walletBalanceBefore.sub(walletBalance).equals(totalAmount)
      ) {
        return failMessage("wallet balance change !== totalAmount");
      }
    }

    // query buyer's contribution
    {
      const status = await getBuyerStatus(
        terra,
        contributor,
        sale.saleId,
        tokenIndex,
        buyers[0].key.accAddress
      );
      if (!status.active || status.active.contribution != totalAmount) {
        return failMessage(`wrong buyer status: ${status}`);
      }
    }

    // query total contributions
    {
      const totalContribution = await getTotalContribution(
        terra,
        contributor,
        sale.saleId,
        tokenIndex
      );
      if (!totalContribution.equals(totalAmount)) {
        return failMessage(`wrong total contribution: ${totalContribution} vs ${totalAmount}`);
      }
    }

    // done
    success();
  }

  {
    logTestName(" 5. User Cannot Contribute for Nonexistent Token Index");

    // dafuq
    let failed = false;
    try {
      const badTokenIndex = 2;
      const denom = "uluna";
      const amount = "42069";

      // ExecuteMsg::Contribute { sale_id, token_index, amount }
      const msg: any = {
        contribute: {
          sale_id: sale.saleId.toString("base64"),
          token_index: badTokenIndex,
          amount,
        },
      };
      const receipt = await executeContract(
        //terra,
        buyers[0],
        contributor,
        msg,
        new Coins([new Coin(denom, amount)])
      );
      logTx("Contribute", receipt);
      failed = receipt.raw_log.includes("AssetInfo not found");
    } catch (e: any) {
      failed = getErrorMessage(e).includes("AssetInfo not found");
    }

    if (!failed) {
      return successUnexpected();
    }

    // done
    success();
  }

  {
    logTestName(" 6. Orchestrator Cannot Attest Contributions Too Early");

    let failed = false;
    try {
      const msg: any = {
        attest_contributions: {
          sale_id: sale.saleId.toString("base64"),
        },
      };
      const receipt = await executeContract(seller, contributor, msg);
      logTx("AttestContributions", receipt);
      failed = receipt.raw_log.includes("SaleNotFinished");
    } catch (e: any) {
      failed = getErrorMessage(e).includes("SaleNotFinished");
    }

    if (!failed) {
      return successUnexpected();
    }

    // done
    success();
  }

  // and we wait for the sale to end
  {
    const blockTime = await getBlockTime(terra);
    if (blockTime < sale.saleEnd) {
      const remaining = sale.saleEnd - blockTime + 2; // need a little buffer
      console.log(`waiting ${remaining} seconds for sale to end`);

      await sleep(remaining * 1000);
    }
  }

  {
    logTestName(" 7. User Cannot Contribute After Sale Ended");

    let failed = false;
    try {
      const denom = "uluna";
      const amount = "42069";

      // ExecuteMsg::Contribute { sale_id, token_index, amount }
      const msg: any = {
        contribute: {
          sale_id: sale.saleId.toString("base64"),
          token_index: 0,
          amount,
        },
      };
      const receipt = await executeContract(
        //terra,
        buyers[0],
        contributor,
        msg,
        new Coins([new Coin(denom, amount)])
      );
      logTx("Contribute", receipt);
      failed = receipt.raw_log.includes("SaleEnded");
    } catch (e: any) {
      failed = getErrorMessage(e).includes("SaleEnded");
    }

    if (!failed) {
      return successUnexpected();
    }

    // done
    success();
  }

  {
    logTestName(" 8. Orchestrator Attests Contributions");

    let log: any = undefined;

    try {
      const msg: any = {
        attest_contributions: {
          sale_id: sale.saleId.toString("base64"),
        },
      };
      const receipt = await executeContract(seller, contributor, msg);
      logTx("AttestContributions", receipt);
      log = receipt.logs[0];
    } catch (e: any) {
      return fail(e);
    }

    // parse attest contributions to see if info agrees with what we expect
    // use total amounts saved in sale
    {
      // 1 := from_contract
      const events = log.events[1].attributes;
      // 4 := bytes from wormhole message
      const expected =
        "02000000000000000000000000000000000000000000000000000000000000000100030100000000000000000000000000000000000000000000000000000000004c4b400000000000000000000000000000000000000000000000000000000000002dc6c0";
      const payload = events[4].value;
      if (payload != expected) {
        return failMessage("wrong attest contribution payload");
      }
    }

    // done
    success();
  }

  {
    logTestName(" 9. Orchestrator Seals Sale");
    untested();
  }

  {
    logTestName("10. Orchestrator Cannot Seal Sale Again");
    untested();
  }

  {
    logTestName("11. User Claims Allocations");
    untested();
  }

  {
    logTestName("12. User Cannot Claim Allocations Again");
    untested();
  }

  return;
}

async function conductAbortedSale(
  terra: LCDClient,
  seller: Wallet,
  buyers: Wallet[]
): Promise<void> {
  // get mock token
  const mockToken = contracts.get("mockToken");
  if (mockToken === undefined) {
    throw Error("mock token not minted yet");
  }

  // get deployed address
  const contributor = contracts.get("contributor");
  if (contributor === undefined) {
    throw Error("contributor not deployed yet");
  }

  // set up saleInit vaa
  const saleId = 2;
  const tokenAddress = "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db";
  const tokenChain = 2;
  const tokenAmount = "1000000000000000000";
  const minRaise = "10000000000000000000";
  const maxRaise = "14000000000000000000";

  // set up sale time based on block time
  const blockTime = await getBlockTime(terra);
  const saleStart = blockTime + 5;
  const saleEnd = blockTime + 60;

  const acceptedTokens: AcceptedToken[] = [
    {
      address: nativeToHexString("uluna", CHAIN_ID_TERRA)!,
      chain: 3,
      conversionRate: "1000000000000000000",
    },
    {
      address: nativeToHexString(mockToken, CHAIN_ID_TERRA)!,
      chain: 3,
      conversionRate: "200000000000000000",
    },
  ];

  const recipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
  const refundRecipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";

  // save state
  const sale: any = {};

  {
    logTestName(" 1. Orchestrator Initializes Sale... ");
    // Conductor will have produced a VAA. Here we fabricate the VAA and
    // forge a signature with devnet guardian
    const data = encodeSaleInit(
      saleId,
      tokenAddress,
      tokenChain,
      tokenAmount,
      minRaise,
      maxRaise,
      saleStart,
      saleEnd,
      acceptedTokens,
      recipient,
      refundRecipient
    );

    // save the sale id and sale end time
    sale.saleId = data.subarray(1, 33);
    sale.saleEnd = saleEnd;

    const timestamp = 1;
    const nonce = 2;
    const sequence = 3;

    const signedVaa = signAndEncodeConductorVaa(timestamp, nonce, sequence, data);

    try {
      // ExecuteMsg::InitSale { signed_vaa }
      const msg: any = {
        init_sale: {
          signed_vaa: signedVaa.toString("base64"),
        },
      };

      const receipt = await executeContract(
        //terra,
        seller,
        contributor,
        msg
      );
      logTx("InitSale", receipt);
    } catch (e: any) {
      return fail(e);
    }

    // done
    success();
  }

  {
    logTestName("2. User Contributes to Sale (Native)");

    const denom = "uluna";

    const tokenIndex = 0;
    const amounts = ["1000000", "2000000"];
    const totalAmount = amounts
      .map((x: string) => new Int(x)!)
      .reduce((x: Int, y: Int) => x.add(y) as Int)
      .toString();

    // save to verify refund
    sale.denomTotalAmount = totalAmount;

    // contribute twice
    try {
      for (const amount of amounts) {
        // ExecuteMsg::Contribute { sale_id, token_index, amount }
        const msg: any = {
          contribute: {
            sale_id: sale.saleId.toString("base64"),
            token_index: tokenIndex,
            amount,
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          contributor,
          msg,
          new Coins([new Coin(denom, amount)])
        );
        logTx("Contribute", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // will not check balances and storage like in successful sale

    // done
    success();
  }

  {
    logTestName(" 3. User Contributes to Sale (CW20)");

    const tokenIndex = 1;
    const amounts = ["2000000", "3000000"];
    const totalAmount = amounts
      .map((x: string) => new Int(x)!)
      .reduce((x: Int, y: Int) => x.add(y) as Int)
      .toString();

    // save to verify refund
    sale.tokenTotalAmount = totalAmount;

    // set allowance for total
    try {
      {
        const msg: any = {
          increase_allowance: {
            spender: contributor,
            amount: totalAmount,
            expires: {
              never: {},
            },
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          mockToken,
          msg
        );
        logTx("IncreaseAllowance", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // contribute twice
    try {
      for (const amount of amounts) {
        // ExecuteMsg::Contribute { sale_id, token_index, amount }
        const msg = {
          contribute: {
            sale_id: sale.saleId.toString("base64"),
            token_index: tokenIndex,
            amount,
          },
        };
        const receipt = await executeContract(
          //terra,
          buyers[0],
          contributor,
          msg
        );
        logTx("Contribute", receipt);
      }
    } catch (e: any) {
      return fail(e);
    }

    // will not check balances and storage like in successful sale

    // done
    success();
  }

  {
    logTestName("4. Orchestrator Aborts Sale");
    const data = encodeSaleAborted(saleId);

    const timestamp = 2;
    const nonce = 0;
    const sequence = 4;

    const signedVaa = signAndEncodeConductorVaa(timestamp, nonce, sequence, data);
    sale.saleAbortedVaa = signedVaa;

    try {
      // ExecuteMsg::SaleAborted { signed_vaa }
      const msg: any = {
        sale_aborted: {
          signed_vaa: signedVaa.toString("base64"),
        },
      };

      const receipt = await executeContract(
        //terra,
        seller,
        contributor,
        msg
      );
      logTx("SaleAborted", receipt);
    } catch (e: any) {
      return fail(e);
    }
    // done
    success();
  }

  {
    logTestName("5. Orchestrator Cannot Abort Sale Again");
    const signedVaa = sale.saleAbortedVaa;

    let failed = false;
    try {
      // ExecuteMsg::SaleAborted { signed_vaa }
      const msg: any = {
        sale_aborted: {
          signed_vaa: signedVaa.toString("base64"),
        },
      };

      const receipt = await executeContract(
        //terra,
        seller,
        contributor,
        msg
      );
      logTx("SaleAborted", receipt);
      failed = receipt.raw_log.includes("SaleEnded");
    } catch (e: any) {
      failed = getErrorMessage(e).includes("SaleEnded");
    }

    if (!failed) {
      return successUnexpected();
    }

    // done
    success();
  }

  {
    logTestName("6. User Claims Refunds");
    untested();
  }

  {
    logTestName("7. User Cannot Claims Refunds Again");
    untested();
  }

  return;
}

function logTestName(test: string): void {
  console.log("\x1b[33m%s\x1b[0m", test);
}

function success(): void {
  console.log("... \x1b[32msuccess!\x1b[0m");
}

function fail(error: any): void {
  //console.log(`... \x1b[41m\x1b[37m${getErrorMessage(error)}\x1b[0m`);
  failMessage(getErrorMessage(error));
}

function successUnexpected(): void {
  failMessage("success unexpected");
}

function failMessage(message: string): void {
  console.log(`... \x1b[41m\x1b[37m${message}\x1b[0m`);
}

function untested(): void {
  console.log("... \x1b[31muntested\x1b[0m");
}

function logTx(prefix: string, receipt: BlockTxBroadcastResult): void {
  console.log(
    `\x1b[36m${prefix}\x1b[0m: https://finder.terra.money/localterra/tx/${receipt.txhash}`
  );
}

function logAddr(prefix: string, addr: string): void {
  console.log(`\x1b[36m${prefix}\x1b[0m: https://finder.terra.money/localterra/address/${addr}`);
}

main();
