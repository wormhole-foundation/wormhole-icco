# Details

This directory contains scripts for contract registration, and proxy pattern upgrades.

### Dependencies

Both `register_testnet_contributors.ts` and `upgrade_testnet_contracts.ts` depend on the following files:

- `testnet.json` - contains the deployed ICCO contract addresses in testnet
- `ethereum/icco_deployment_config.js` - contains rpc providers and wallet private keys

### Building

Run the following command in the root directory to build the ICCO tools:

```sh
make sdk
```

# Example Contract Registration

```sh
ts-node register_testnet_contributors.ts --network goerli fuji binance_testnet
```

### Arguments

- **--network** is required. The list of `Contributor` contract networks that will be registered

# Example Contract Upgrade

Before upgrading the contract, the implementation address must exist in `testnet.json`

```sh
ts-node upgrade_testnet_contracts.ts --contractType contributor --network goerli
```

### Arguments

- **--network** is required. The `Contributor` or `Conductor` contract network that will be upgraded.
- **--contractType** is required. The type of contract to upgrade.
