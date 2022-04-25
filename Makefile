-include Makefile.help

.PHONY: dependencies test clean all

all: build

.PHONY: build
## Build all Smart Contracts
build: ethereum terra

.PHONY: ethereum
ethereum: ethereum/build

ethereum/build:
	cd ethereum && make build

.PHONY: terra
terra: terra/artifacts/checksum.txt

terra/artifacts/checksum.txt:
	cd terra && make artifacts

.PHONY: tilt-test
## Run Integration Test in Tilt
tilt-test: sdk/js/src/icco/__tests__/tilt.json
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd sdk/js && npm run build && npm run test

sdk/js/src/icco/__tests__/tilt.json:
	cp tilt.json sdk/js/src/icco/__tests__/tilt.json

.PHONY: tilt-deploy
## Deploy Contracts to Tilt
tilt-deploy: ethereum terra
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	cd ethereum && make tilt-deploy && npx truffle exec scripts/register_tilt_contributors.js --network eth_devnet
#	cd terra && make terrad-deploy
#	cd ethereum && node scripts/

.PHONY: clean
## Remove All Builds
clean:
	cd ethereum && make clean
	cd terra && make clean

.PHONY: tilt-clean
## Remove Everything For Tilt
tilt-clean: clean
	rm -f sdk/js/src/icco/__tests__/tilt.json