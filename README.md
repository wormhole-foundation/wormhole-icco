## Wormhole ICCO

A trustless cross-chain mechanism to conduct a token sale. Please read the [whitepaper](WHITEPAPER.md) for background and design.

## Running in Devnet (Tilt)

To test the contract interactions, you will need to run Tilt from the [Wormhole repo](https://github.com/certusone/wormhole/tree/dev.v2).
Once Tilt is up, you can now deploy the contracts:

```sh
make tilt-deploy
```

To run the SDK integration test:

```sh
make tilt-test
```
