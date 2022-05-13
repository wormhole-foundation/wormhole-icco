### Building

Build the contracts by running `make build`

### Testing

Run the tests by running `make test`

The tests can be found here `tests/icco.js`

### Deploying ICCO to testnet

To deploy the Conductor and Contributor smart contracts to testnet you will need do the following:

1. Set up the ICCO deployment config: `icco_deployment_config.js`

   - Each network in the deployment config has several parameters:

     - `conductorChainId` - the network that the `Conductor` contract is (or will be) deployed to
     - `contributorChainId` - the network that `Contributor` contract will be deployed to
     - `authority` - the public key of the KYC authority for the contributor
       - This value does not have to be set when deploying the `Conductor` contract.
     - `consistencyLevel` - number of confirmations
     - `wormhole`- the wormhole coreBridge address
     - `tokenBridge` -the wormhole tokenBridge address
     - `mnemonic` - private key for deployment wallet
     - `rpc` - URL for deployment provider

   - The `conductorChainId` and `contributorChainId` should be the same only if both contracts are deployed on the same network
   - ChainIDs for each network can be found here: <https://docs.wormholenetwork.com/wormhole/contracts>

2. Deploy the `Conductor` contract with the following command:

   - npx truffle migrate --f 2 --to 2 --network (`network key from icco_deployment_config.js`) --skip-dry-run

3. Deploy the `Contributor` contract(s) with the following command:

   - npx truffle migrate --f 3 --to 3 --network (`network key from icco_deployment_config.js`) --skip-dry-run

4. Follow the instructions in the README.md in `tools/` for `Contributor` contract registration
