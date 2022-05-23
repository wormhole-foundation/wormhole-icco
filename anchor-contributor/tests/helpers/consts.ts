import { CHAIN_ID_ETH, tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { web3 } from "@project-serum/anchor";

// wormhole
export const CORE_BRIDGE_ADDRESS = new web3.PublicKey("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o");

// contributor
export const CONDUCTOR_CHAIN = CHAIN_ID_ETH as number;
export const CONDUCTOR_ADDRESS = tryNativeToUint8Array("0x5c49f34D92316A2ac68d10A1e2168e16610e84f9", CHAIN_ID_ETH);
