const fs = require("fs");
import { web3 } from "@project-serum/anchor";
import {
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_AVAX,
  CHAIN_ID_SOLANA,
} from "@certusone/wormhole-sdk";

export const WORMHOLE_ADDRESSES = require("../cfg/wormholeAddresses.js");
export const TESTNET_ADDRESSES = JSON.parse(
  fs.readFileSync(`${__dirname}/../../../testnet.json`, "utf8")
);
export const SALE_CONFIG = JSON.parse(
  fs.readFileSync(`${__dirname}/../cfg/saleConfig.json`, "utf8")
);
export const CONTRIBUTOR_INFO = JSON.parse(
  fs.readFileSync(`${__dirname}/../cfg/contributors.json`, "utf8")
);
export const SOLANA_IDL = JSON.parse(
  fs.readFileSync(`${__dirname}/../solana/anchor_contributor.json`, "utf8")
);

// VAA fetching params
export const RETRY_TIMEOUT_SECONDS = 180;

// deployment info for the sale
export const SOLANA_RPC = SALE_CONFIG["initiatorWallet"]["solana_testnet"].rpc;
export const SOLANA_CORE_BRIDGE_ADDRESS = new web3.PublicKey(
  WORMHOLE_ADDRESSES.solana_testnet.wormhole
);
export const CONDUCTOR_ADDRESS = TESTNET_ADDRESSES.conductorAddress;
export const CONDUCTOR_CHAIN_ID = TESTNET_ADDRESSES.conductorChain;
export const CONDUCTOR_NETWORK = SALE_CONFIG["conductorNetwork"];
export const KYC_AUTHORITY_KEY = SALE_CONFIG["authority"];
export const CONTRIBUTOR_NETWORKS: string[] = [
  "goerli",
  "fuji",
  "solana_testnet",
];
export const CHAIN_ID_TO_NETWORK = new Map<ChainId, string>();
CHAIN_ID_TO_NETWORK.set(CHAIN_ID_ETH, CONTRIBUTOR_NETWORKS[0]);
CHAIN_ID_TO_NETWORK.set(CHAIN_ID_AVAX, CONTRIBUTOR_NETWORKS[1]);
CHAIN_ID_TO_NETWORK.set(CHAIN_ID_SOLANA, CONTRIBUTOR_NETWORKS[2]);
