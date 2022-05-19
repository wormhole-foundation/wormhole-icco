#!/usr/bin/env bash
# This script deploys built icco contributor solana contract to tilt devnet.
# Program Id: 5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM

# print statements:
set -x

cd modules/icco_contributor
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" cargo build-bpf
cd -

cd modules/icco_contributor/program
EMITTER_ADDRESS="11111111111111111111111111111115" BRIDGE_ADDRESS="Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o" wasm-pack build --target nodejs -d node -- --features wasm
mkdir -p ../../../../sdk/js/src/solana/icco_contributor-node
cp node/* ../../../../sdk/js/src/solana/icco_contributor-node/
cd -

minikube kubectl -- cp -c devnet devnet.json  solana-devnet-0:/root/.config/solana/id.json
minikube kubectl -- cp -c devnet modules/icco_contributor/contributor_id.json  solana-devnet-0:/usr/src/
minikube kubectl -- cp -c devnet modules/icco_contributor/target/deploy/icco_contributor.so solana-devnet-0:/usr/src/
minikube kubectl -- exec -c devnet solana-devnet-0 -- solana program deploy -u l --program-id=/usr/src/contributor_id.json /usr/src/icco_contributor.so

# register conductor as emitter on solana contributor or tests will go bad.
# this succeds only first itme after tilt up, then it will fail because config PDA account was already initialized.

# ./modules/icco_contributor/target/debug/client create-bridge 5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE
con_addr=$(node read_conductor_address.js)
./modules/icco_contributor/target/debug/client create-bridge 5yrpFgtmiBkRmDgveVErMWuxC25eK5QE5ouZgfi46aqM B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE ${con_addr}
