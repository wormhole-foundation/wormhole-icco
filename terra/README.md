# ICCO On Terra

Currently there is only a Contributor that will exist on the Terra blockchain.

## Building WASMs

```sh
make build
```

## Running Unit Tests

```sh
make unit-test
```

This will run `cargo clippy` and `cargo test`.

## Running Integration Tests in LocalTerra

```sh
make integration-test
```

This will automatically build [scripts](scripts) if these were not built already and run tests outlined [here](scripts/tests).

## Deploy

TODO
