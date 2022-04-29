## Deployment and Test Scripts

### Setup

```sh
npm ci && npm run build
```

Alternatively, in the [parent](..) directory, run the following `make` command:

```sh
make scripts
```

### Deploy

See all arguments of deploy using the `--help` argument.

```sh
node lib/deploy.js --help
```

There are four places you can deploy your contracts:

- `mainnet` (columbus-5)
- `testnet` (bombay-12)
- `localterra` (your [LocalTerra](https://github.com/terra-money/LocalTerra) instance)
- `tilt` (devnet [Wormhole](https://github.com/certusone/wormhole) environment)

Running `deploy.js` will write contract addresses to a file that can be used as a reference for other processes (e.g. `--network tilt` will write to `tilt.json` in the root directory of the ICCO repo).

### Tests

These tests will require [LocalTerra](https://github.com/terra-money/LocalTerra) running. In the [parent](..) directory, all you need to do is run the following `make` command.

```sh
make integration-test
```

This will automatically spawn an instance of LocalTerra and run the tests against this instance.

Go [here](tests) for more info about the specific tests.

---

_Structure heavily borrowed from [Astroport's scripts directory](https://github.com/astroport-fi/astroport-core/tree/main/scripts)._
