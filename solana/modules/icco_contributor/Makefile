export BRIDGE_ADDRESS=Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o
###EMITTER_ADDRESS=CiByUvEcx7w2HA4VHcPCBUAFQ73Won9kB36zW9VjirSr
export EMITTER_ADDRESS=11111111111111111111111111111115

WORMHOLE=../../..

-include ../../../Makefile.help

.PHONY: unit-test integration-test .FORCE

.FORCE:

.PHONY: clean
## Remove Builds
clean:
	rm -rf validator.log target

.PHONY: wormhole
## Build Wormhole Contracts
wormhole: ${WORMHOLE}/wormhole/solana/artifacts-devnet

${WORMHOLE}/wormhole/solana/artifacts-devnet:
	cd ${WORMHOLE} && make wormhole/solana/artifacts-devnet

target/deploy/icco_contributor.so: .FORCE
	cargo build-bpf

.PHONY: build
## Build Contract
build: target/deploy/icco_contributor.so

/tmp/ledger:
	mkdir -p $@

.PHONY: unit-test
## Run Unit Tests (TODO)
unit-test:
	cargo test

.PHONY: integration-test
## Run Integration Test (TODO)
integration-test: build wormhole /tmp/ledger
	@if pgrep solana-test; then pkill solana-test; fi
	@sleep 1
	bash run_test_validator.sh > validator.log 2>&1 &
	@sleep 5
###	BRIDGE_PAYER=/tmp/ledger/faucet-keypair.json cargo test || (pkill solana-test && exit 1)
	@pkill solana-test

