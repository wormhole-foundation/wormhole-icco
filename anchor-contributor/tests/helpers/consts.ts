import { hexToUint8Array } from "@certusone/wormhole-sdk";
import { web3 } from "@project-serum/anchor";

// wormhole
export const CORE_BRIDGE_ADDRESS = new web3.PublicKey("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o");

// contributor
export const CONDUCTOR_CHAIN: number = parseInt(process.env.CONDUCTOR_CHAIN);
export const CONDUCTOR_ADDRESS: Uint8Array = hexToUint8Array(process.env.CONDUCTOR_ADDRESS);
export const GLOBAL_KYC_AUTHORITY: Uint8Array = hexToUint8Array(process.env.GLOBAL_KYC_AUTHORITY);
