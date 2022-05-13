# Details

This directory contains scripts necessary for making deployed ICCO contracts function. Currently, both scripts are used for registering
`Contributor` contracts with their `Conductor` counterpart.

### Dependencies

`register_testnet_contributors.ts` depends on the following files:

- `../testnet.json` - contains the deployed ICCO contract addresses in testnet
- `ethereum/icco_deployment_config.js` - contains rpc providers and wallet private keys

`register_tilt_contributors.ts` depends on the following file:

- `../tilt.json` - contains the deployed ICCO contract addresses in tilt devnet

### Building

Run the following commands to build the ICCO tools:

```sh
npm ci
npm run build
```

# Running

### Example Usage

```sh
node lib/register_testnet_contributors.js --network goerli fuji binance_testnet
```

### Arguments

- **--network** is required. The list of `Contributor` contract networks that will be registered
