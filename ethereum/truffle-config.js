require("dotenv").config({ path: ".env" });
const HDWalletProvider = require("@truffle/hdwallet-provider");

const DeploymentConfig = require(`${__dirname}/icco_deployment_config.js`);

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
    },
    // for tilt (eth-devnet)
    eth_devnet: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
    },
    // for tilt (eth-devnet2)
    eth_devnet2: {
      host: "127.0.0.1",
      port: 8546,
      network_id: "*",
    },
    mainnet: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["mainnet"].mnemonic,
          DeploymentConfig["mainnet"].rpc
        ),
      network_id: 1,
      gas: 10000000,
      gasPrice: 191000000000,
      confirmations: 1,
      timeoutBlocks: 200,
      skipDryRun: false,
    },
    goerli: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["goerli"].mnemonic,
          DeploymentConfig["goerli"].rpc
        );
      },
      network_id: "5",
      gas: 4465030,
      gasPrice: 10000000000,
    },
    binance: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["binance"].mnemonic,
          DeploymentConfig["binance"].rpc
        );
      },
      network_id: "56",
      gas: 70000000,
      gasPrice: 8000000000,
    },
    binance_testnet: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["binance_testnet"].mnemonic,
          DeploymentConfig["binance_testnet"].rpc
        ),
      network_id: "97",
      gas: 29000000,
      gasPrice: 10000000000,
    },
    polygon: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["polygon"].mnemonic,
          DeploymentConfig["polygon"].rpc
        );
      },
      network_id: "137",
      gas: 10000000,
      gasPrice: 700000000000,
    },
    mumbai: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["mumbai"].mnemonic,
          DeploymentConfig["mumbai"].rpc
        );
      },
      network_id: "80001",
    },
    avalanche: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["avalanche"].mnemonic,
          DeploymentConfig["avalanche"].rpc
        );
      },
      network_id: "43114",
      gas: 8000000,
      gasPrice: 26000000000,
    },
    fuji: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["fuji"].mnemonic,
          DeploymentConfig["fuji"].rpc
        ),
      network_id: "43113",
    },
    fantom_testnet: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["fantom_testnet"].mnemonic,
          DeploymentConfig["fantom_testnet"].rpc
        );
      },
      network_id: 0xfa2,
      gas: 4465030,
      gasPrice: 300000000000,
    },
  },

  compilers: {
    solc: {
      version: "0.8.4",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },

  plugins: ["@chainsafe/truffle-plugin-abigen", "truffle-plugin-verify"],

  api_keys: {
    etherscan: process.env.ETHERSCAN_KEY,
  },
};
