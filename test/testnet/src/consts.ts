const fs = require("fs");
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_AVAX } from "@certusone/wormhole-sdk";

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

// VAA fetching params
export const RETRY_TIMEOUT_SECONDS = 180;

// deployment info for the sale
export const CONDUCTOR_ADDRESS = TESTNET_ADDRESSES.conductorAddress;
export const CONDUCTOR_CHAIN_ID = TESTNET_ADDRESSES.conductorChain;
export const CONDUCTOR_NETWORK = SALE_CONFIG["conductorNetwork"];
export const KYC_AUTHORITY_KEY = SALE_CONFIG["authority"];
export const CONTRIBUTOR_NETWORKS: string[] = ["goerli", "fuji"];
export const CHAIN_ID_TO_NETWORK = new Map<ChainId, string>();
CHAIN_ID_TO_NETWORK.set(CHAIN_ID_ETH, CONTRIBUTOR_NETWORKS[0]);
CHAIN_ID_TO_NETWORK.set(CHAIN_ID_AVAX, CONTRIBUTOR_NETWORKS[1]);
