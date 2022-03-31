For tilt devnet:
build using

```
from: wormhole-icco/solana/modules/icco_contributor
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo check
or
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo build
or
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo build-bpf
```

To verify that wasm builds:

```
from: wormhole-icco/solana/modules/icco_contributor/program
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="11111111111111111111111111111115" wasm-pack build --target bundler -d bundler -- --features wasm --locked
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


wormhole-icco/solana/Dockerfile (bpf contract building)
add following lines to appropriate places in RUN command:
    --mount=type=cache,target=modules/icco_contributor/target \
    cargo build-bpf --manifest-path "modules/icco_contributor/program/Cargo.toml" -- --locked && \
    cp modules/icco_contributor/target/deploy/icco_contributor.so /opt/solana/deps/icco_contributor.so && \
```

OPTIONALLY - Deploying contributor contract to tilt devnet with new address:

```
in solana directory:

0. Only need to do once, Copy secret key and contract key to tilt location
kubectl cp -c devnet keys/solana-devnet.json  solana-devnet-0:/root/.config/solana/id.json
1. Copy bpf and contract address to tilt
kubectl cp -c devnet modules/icco_contributor/target/deploy/icco_contributor.so solana-devnet-0:/usr/src/
2. deploy to solana devnet
kubectl exec -c devnet solana-devnet-0 -- solana program deploy -u l /usr/src/icco_contributor.so
```
