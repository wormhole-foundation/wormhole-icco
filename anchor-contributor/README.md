## ICCO Built with Anchor

### Dependencies

- Solana CLI (1.10.24)
- Anchor CLI (0.24.2)
- yarn (1.22.\*)
- node (16.\*)

### Tests

Unit tests (which just runs `cargo test`).

```sh
yarn run unit-test
```

Integration test using Anchor's local validator, which includes Wormhole and Token Bridge interaction.

```sh
yarn run integration-test
```

**NOTE: expect one failing test, which attempts to invoke Token Bridge program to transfer contributions to conductor.**

### Deploy

Currently there is only one deployment command in yarn, which deploys the contributor contract to devnet. _If you deploy
a new conductor, you will need to replace the existing `CONDUCTOR_ADDRESS` with that newly deployed contract address._

You need to specify a `WALLET` variable, which will be used to pay for deployment.

```sh
WALLET=path/to/your/key.json yarn run deploy-devnet
```

### Other Notes

We manage compile-time constants with environment variables found in `test.env` and `devnet.env`. When it comes time
to deploy to mainnet, make a corresponding `mainnet.env` file. If you inadvertently source these files outside of
any of the provided scripts, you can run `. unset.env` to unset all these variables.
