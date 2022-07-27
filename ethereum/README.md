### Building

Build the contracts by running `make build`.

### Testing

Run the tests by running `make test`. The tests can be found [here](test/icco.js).

### Conductor Error Codes

The Conductor's revert strings are codified, please see CONDUCTOR_ERROR_CODES.md [here](CONDUCTOR_ERROR_CODES.md).

### Deploying ICCO to EVM testnets

To deploy the Conductor and Contributor smart contracts to testnet, follow the procedure below.

**Set up the ICCO deployment config.** Each network in `icco_deployment_config.js` has several parameters:

- `conductorChainId` - the network that the `Conductor` contract is (or will be) deployed to
- `contributorChainId` - the network that `Contributor` contract will be deployed to
- `consistencyLevel` - number of confirmations
- `wormhole`- the wormhole coreBridge address
- `tokenBridge` -the wormhole tokenBridge address
- `mnemonic` - private key for deployment wallet
- `rpc` - URL for deployment provider

There is a [sample config](icco_deployment_config.js.sample) that you can copy to `icco_deployment_config.js` to help you get started.

The `conductorChainId` and `contributorChainId` should be the same only if both contracts are deployed on the same network. ChainIDs for each network can be found [here](https://docs.wormholenetwork.com/wormhole/contracts).

Deploy the `Conductor` contract with the following command, where `your_network` corresponds to a network name from `icco_deployment_config.js`.

```sh
npm run deploy-conductor your_network
```

And deploy the `Contributor` contract(s) for any network you want to collect contributions from.

```sh
npm run deploy-contributor your_network
```

These commands work for mainnet networks you configure, too. After deploying your contracts, follow the instructions in the README.md in `tools/` for `Contributor` contract registration.
