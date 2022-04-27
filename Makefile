-include Makefile.help

.PHONY: clean all ethereum terra tilt-deploy tilt-test

all: ethereum terra sdk

.PHONY: clean
## Remove All Builds
clean:
	cd ethereum && make clean
	cd terra && make clean
	cd sdk/js && rm -rf node_modules contracts lib src/icco/__tests__/tilt.json
	rm -f tilt.json

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
sdk: ethereum sdk/js/node_modules
	cd sdk/js && npm run build

sdk/js/node_modules:
	cd sdk/js && npm ci

.PHONY: tilt-deploy
## Deploy Contracts to Tilt
tilt-deploy: ethereum terra
	rm -f tilt.json
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd ethereum && make tilt-deploy
	cd ethereum && npx truffle exec scripts/register_tilt_contributors.js --network eth_devnet
	cp tilt.json sdk/js/src/icco/__tests__/tilt.json

.PHONY: tilt-test
## Run Integration Test in Tilt
tilt-test: sdk
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd sdk/js && npm run build && npm run test
