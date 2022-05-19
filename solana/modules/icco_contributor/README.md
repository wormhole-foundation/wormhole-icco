## Prepare Your Environment

Install `solana` cli (version 1.9.4)

```sh
sh -c "$(curl -sSfL https://release.solana.com/v1.9.4/install)"
```

Install `wasm-pack`

```sh
cargo install wasm-pack
```

Make sure `$HOME/.local/share/solana/install/active_release/bin` and `$HOME/.cargo/bin` are in your `$PATH` environment variable.

## Build

```
Notion designlink:
https://www.notion.so/677ea05b110347279846b709e7d000c1?v=0361b046678e42dfb1bfe2887c13750d&p=8b34da4ecc4249239216d8e2bf9c720e
https://www.notion.so/ICCO-On-Solana-8b34da4ecc4249239216d8e2bf9c720e
```

local check For tilt devnet:

build using:

```
from: wormhole-icco/solana/modules/icco_contributor
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo check
or
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo build
or
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo build-bpf
```

Buid or check wasm build:

```
from: wormhole-icco/solana/modules/icco_contributor/program
#EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" wasm-pack build --target bundler -d bundler -- --features wasm
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" wasm-pack build --target nodejs -d node -- --features wasm
cp node/* ../../../../sdk/js/src/solana/icco_contributor-node/
```

To add building and deployement of icco_contributor to tilt:

```
wormhole-icco/devnet/solana-devnet.yaml
add
            - --bpf-program
            - 22mamxmojFWBdbGqaxTH46HBAgAY2bJRiGJJHfNRNQ95
            - /opt/solana/deps/icco_contributor.so


wormhole-icco/solana/Dockerfile.wasm (wasm building)
add:
# Compile icco_contributor
RUN --mount=type=cache,target=/root/.cache \
	--mount=type=cache,target=modules/icco_contributor/target \
    cd modules/icco_contributor/program && /usr/local/cargo/bin/wasm-pack build --target bundler -d bundler -- --features wasm --locked && \
    cd bundler && sed -i $SED_REMOVE_INVALID_REFERENCE icco_contributor_bg.js

RUN --mount=type=cache,target=/root/.cache \
	--mount=type=cache,target=modules/icco_contributor/target \
    cd modules/icco_contributor/program && /usr/local/cargo/bin/wasm-pack build --target nodejs -d nodejs -- --features wasm --locked

COPY --from=build /usr/src/bridge/modules/icco_contributor/program/bundler sdk/js/src/solana/icco_contributor
COPY --from=build /usr/src/bridge/modules/icco_contributor/program/nodejs sdk/js/src/solana/icco_contributor-node


wormhole-icco/solana/Dockerfile (bpf contract building)
add following lines to appropriate places in RUN command:
    --mount=type=cache,target=modules/icco_contributor/target \
    cargo build-bpf --manifest-path "modules/icco_contributor/program/Cargo.toml" -- --locked && \
    cp modules/icco_contributor/target/deploy/icco_contributor.so /opt/solana/deps/icco_contributor.so && \
```

OPTIONALLY - Deploying contributor contract to tilt devnet with new address:

```
wormhole-icco/solana/ directory:

0. Need to do every time tilt reloads Solana node..  Copy secret key and contract Id key to tilt.
kubectl cp -c devnet keys/solana-devnet.json  solana-devnet-0:/root/.config/solana/id.json
kubectl cp -c devnet modules/icco_contributor/contributor_id.json  solana-devnet-0:/usr/src/

1. Copy locally built bpf to tilt
kubectl cp -c devnet modules/icco_contributor/target/deploy/icco_contributor.so solana-devnet-0:/usr/src/

2. deploy to solana devnet
kubectl exec -c devnet solana-devnet-0 -- solana program deploy -u l --program-id=/usr/src/contributor_id.json /usr/src/icco_contributor.so
// returns Program Id: 5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM

kubectl exec -c devnet solana-devnet-0 -- solana program deploy -u l /usr/src/icco_contributor.so       // This makes new contract address every time
```

to register coreBridge and conductor run the following from solana/
./modules/icco_contributor/target/debug/client create-bridge 5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE
addresses are: contributor, coreBridge, Conductor(fake for now)
