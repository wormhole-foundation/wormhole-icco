import { web3 } from "@project-serum/anchor";
import { ethers } from "ethers";
import { ChainId, CHAIN_ID_AVAX, CHAIN_ID_ETH } from "@certusone/wormhole-sdk";

import { readJson } from "./io";

interface EvmWallets {
  endpoint: string;
  provider: ethers.providers.Provider;
  wallets: ethers.Wallet[];
}

interface SolanaWallets {
  endpoint: string;
  provider: web3.Connection;
  wallets: web3.Keypair[];
}

export class Purse {
  avax: EvmWallets;
  ethereum: EvmWallets;
  solana: SolanaWallets;

  constructor(filename: string) {
    const cfg = readJson(filename);

    this.avax = {
      endpoint: cfg.avax.rpc,
      provider: new ethers.providers.StaticJsonRpcProvider(cfg.avax.rpc),
      wallets: [],
    };
    this.ethereum = {
      endpoint: cfg.ethereum.rpc,
      provider: new ethers.providers.StaticJsonRpcProvider(cfg.ethereum.rpc),
      wallets: [],
    };
    this.solana = {
      endpoint: cfg.solana.rpc,
      provider: new web3.Connection(cfg.solana.rpc),
      wallets: [],
    };

    // solana devnet
    for (const key of cfg.solana.wallets) {
      this.solana.wallets.push(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
    }

    // fuji
    for (const pk of cfg.avax.wallets) {
      this.avax.wallets.push(new ethers.Wallet(pk, this.avax.provider));
    }

    // goerli
    for (const pk of cfg.ethereum.wallets) {
      this.ethereum.wallets.push(new ethers.Wallet(pk, this.ethereum.provider));
    }
  }

  getEvmWallet(chainId: ChainId, index: number) {
    switch (chainId) {
      case CHAIN_ID_ETH: {
        return this.ethereum.wallets.at(index);
      }
      case CHAIN_ID_AVAX: {
        return this.avax.wallets.at(index);
      }
      default: {
        throw Error("unrecognized chainId");
      }
    }
  }

  getSolanaWallet(index: number) {
    return this.solana.wallets.at(index);
  }
}
