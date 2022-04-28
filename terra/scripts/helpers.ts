import "dotenv/config";
import {
  Coin,
  Coins,
  LCDClient,
  LocalTerra,
  MnemonicKey,
  Msg,
  MsgExecuteContract,
  MsgInstantiateContract,
  MsgMigrateContract,
  MsgStoreCode,
  MsgUpdateContractAdmin,
  Tx,
  Wallet,
} from "@terra-money/terra.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { CustomError } from "ts-custom-error";

const DEFAULT_GAS_CURRENCY = "uusd";
const DEFAULT_GAS_PRICE = 0.15;

const TESTNET = {
  URL: "https://bombay-lcd.terra.dev",
  chainID: "bombay-12",
  name: "testnet",
};

const MAINNET = {
  URL: "https://lcd.terra.dev",
  chainID: "columbus-5",
  name: "mainnet",
};

export interface Client {
  wallet: Wallet;
  terra: LCDClient | LocalTerra;
}

export function writeContractAddress(fp: string, name: string, addr: string) {
  const contents = existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : {};
  contents[name] = addr;
  writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  return;
}

export function newClient(
  network: string,
  mnemonic: string | undefined
): Client {
  if (network == "mainnet" || network == "testnet") {
    if (mnemonic === undefined) {
      throw Error("mnemonic undefined");
    }

    const config = network == "testnet" ? TESTNET : MAINNET;
    const terra = new LCDClient(config);
    return {
      terra,
      wallet: recover(terra, mnemonic),
    };
  }

  const terra = new LocalTerra();
  return {
    terra,
    wallet: (terra as LocalTerra).wallets.test1,
  };
}

// Tequila lcd is load balanced, so txs can't be sent too fast, otherwise account sequence queries
// may resolve an older state depending on which lcd you end up with. Generally 1000 ms is enough
// for all nodes to sync up.
let TIMEOUT = 1000;

export function setTimeoutDuration(t: number) {
  TIMEOUT = t;
}

export function getTimeoutDuration() {
  return TIMEOUT;
}

export async function sleep(timeout: number) {
  await new Promise((resolve) => setTimeout(resolve, timeout));
}

export class TransactionError extends CustomError {
  public constructor(
    public code: number,
    public codespace: string | undefined,
    public rawLog: string
  ) {
    super("transaction failed");
  }
}

export async function createTransaction(wallet: Wallet, msg: Msg) {
  let gas_currency = process.env.GAS_CURRENCY! || DEFAULT_GAS_CURRENCY;
  let gas_price = process.env.GAS_PRICE! || DEFAULT_GAS_PRICE;
  return await wallet.createAndSignTx({
    msgs: [msg],
    gasPrices: [new Coin(gas_currency, gas_price)],
  });
}

export async function broadcastTransaction(terra: LCDClient, signedTx: Tx) {
  const result = await terra.tx.broadcast(signedTx);
  await sleep(TIMEOUT);
  return result;
}

export async function performTransaction(
  terra: LCDClient,
  wallet: Wallet,
  msg: Msg
) {
  const signedTx = await createTransaction(wallet, msg);
  const result = await broadcastTransaction(terra, signedTx);
  //if (isTxError(result)) {
  //  throw new TransactionError(parseInt(result.code), result.codespace, result.raw_log);
  //}
  return result;
}

export async function uploadContract(
  terra: LCDClient,
  wallet: Wallet,
  filepath: string
) {
  const contract = readFileSync(filepath, "base64");
  const uploadMsg = new MsgStoreCode(wallet.key.accAddress, contract);
  const receipt = await performTransaction(terra, wallet, uploadMsg);

  // @ts-ignore
  const ci = /"code_id","value":"([^"]+)/gm.exec(receipt.raw_log)[1];
  return parseInt(ci);
  //return Number(result.logs[0].eventsByType.store_code.code_id[0]); // code_id
}

export async function instantiateContract(
  terra: LCDClient,
  wallet: Wallet,
  admin_address: string,
  codeId: number,
  msg: object
) {
  const instantiateMsg = new MsgInstantiateContract(
    wallet.key.accAddress,
    admin_address,
    codeId,
    msg,
    undefined
  );
  let result = await performTransaction(terra, wallet, instantiateMsg);
  return result.logs[0].events[0].attributes
    .filter((element) => element.key == "contract_address")
    .map((x) => x.value)[0];
}

export async function executeContract(
  terra: LCDClient,
  wallet: Wallet,
  contractAddress: string,
  msg: object,
  coins?: Coins.Input
) {
  const executeMsg = new MsgExecuteContract(
    wallet.key.accAddress,
    contractAddress,
    msg,
    coins
  );
  return await performTransaction(terra, wallet, executeMsg);
}

export async function queryContract(
  terra: LCDClient,
  contractAddress: string,
  query: object
): Promise<any> {
  return await terra.wasm.contractQuery(contractAddress, query);
}

export async function deployContract(
  terra: LCDClient,
  wallet: Wallet,
  admin_address: string,
  filepath: string,
  initMsg: object
) {
  const codeId = await uploadContract(terra, wallet, filepath);
  return await instantiateContract(
    terra,
    wallet,
    admin_address,
    codeId,
    initMsg
  );
}

export async function migrate(
  terra: LCDClient,
  wallet: Wallet,
  contractAddress: string,
  newCodeId: number,
  msg: object
) {
  const migrateMsg = new MsgMigrateContract(
    wallet.key.accAddress,
    contractAddress,
    newCodeId,
    msg
  );
  return await performTransaction(terra, wallet, migrateMsg);
}

export function recover(terra: LCDClient, mnemonic: string) {
  const mk = new MnemonicKey({ mnemonic: mnemonic });
  return terra.wallet(mk);
}

export async function update_contract_admin(
  terra: LCDClient,
  wallet: Wallet,
  contract_address: string,
  admin_address: string
) {
  let msg = new MsgUpdateContractAdmin(
    wallet.key.accAddress,
    admin_address,
    contract_address
  );

  return await performTransaction(terra, wallet, msg);
}
