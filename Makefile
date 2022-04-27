-include Makefile.help

.PHONY: clean all ethereum terra tilt-deploy tilt-test

all: ethereum terra sdk

.PHONY: clean
## Remove All Builds
clean:
	rm -rf wormhole tilt.json
	cd ethereum && make clean
	cd terra && make clean
	cd sdk/js && rm -rf node_modules contracts lib src/icco/__tests__/tilt.json
	cd tools && rm -rf node_modules lib

.PHONY: ethereum
## Build Ethereum contracts
ethereum: ethereum/build

ethereum/build:
	cd ethereum && make build

.PHONY: terra
## Build Terra contracts
terra: terra/artifacts/checksum.txt

terra/artifacts/checksum.txt:
	cd terra && make build

.PHONY: sdk
## Build SDK
sdk: sdk/js/lib

sdk/js/lib: ethereum sdk/js/node_modules
	cd sdk/js && npm run build

sdk/js/node_modules:
	cd sdk/js && npm ci

.PHONY: tools
## Build tools (scripts in tools directory)
tools: tools/lib

tools/lib: sdk
	cd tools && npm ci && npm run build

.PHONY: tilt-deploy
## Deploy Contracts to Tilt
tilt-deploy: ethereum tools #terra
	rm -f tilt.json
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd ethereum && make tilt-deploy
	node tools/lib/register_tilt_contributors.js
	cp tilt.json sdk/js/src/icco/__tests__/tilt.json

.PHONY: tilt-test
## Run Integration Test in Tilt
tilt-test: sdk sdk/js/src/icco/__tests__/tilt.json
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd sdk/js && npm run build && npm run test

wormhole:
	git clone --depth 1 --branch dev.v2 --single-branch https://github.com/certusone/wormhole.git

wormhole/solana/artifacts-devnet: wormhole
	cd wormhole/solana && NETWORK=devnet make artifacts

wormhole/ethereum/build: wormhole
	cd wormhole/ethereum && make build
