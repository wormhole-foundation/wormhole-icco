import { web3 } from "@project-serum/anchor";

// wormhole
export const CORE_BRIDGE_ADDRESS = new web3.PublicKey(process.env.CORE_BRIDGE_ADDRESS);
export const TOKEN_BRIDGE_ADDRESS = new web3.PublicKey(process.env.TOKEN_BRIDGE_ADDRESS);

// contributor
export const CONDUCTOR_CHAIN: number = parseInt(process.env.CONDUCTOR_CHAIN);
export const CONDUCTOR_ADDRESS: string = process.env.CONDUCTOR_ADDRESS;

// kyc
export const KYC_PRIVATE_OLD: string = "b0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773";
export const KYC_PUBLIC_OLD: string = "1df62f291b2e969fb0849d99d9ce41e2f137006e";

export const KYC_PRIVATE_NEW: string = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const KYC_PUBLIC_NEW: string = "befa429d57cd18b7f8a4d91a2da9ab4af05d0fbe";
