icco_contributor_SOURCE=icco_contributor

SOURCE_FILES=$(shell find . -name "*.rs" -or -name "*.lock" -or -name "*.toml" | grep -v target)

PACKAGES=$(shell find . -name "Cargo.toml" | grep -E '\./contracts' | cut -d/ -f3 | sed s/-/_/g)
WASMS=$(patsubst %, artifacts/%.wasm, $(PACKAGES))

-include ../Makefile.help

.PHONY: clean build tools unit-test integration-test
## Remove All Builds
clean:
	rm -rf artifacts wormhole localterra.json testnet.json mainnet.json
	cd scripts && npm run clean

.PHONY: wormhole
## Fetch Wormhole dev.v2 and build Terra contract
wormhole: wormhole/terra/artifacts

wormhole/terra/artifacts:
	git clone --depth 1 --branch dev.v2 --single-branch https://github.com/certusone/wormhole.git
	cd wormhole/terra && make artifacts && make tools/node_modules
	cd wormhole && bash scripts/guardian-set-init.sh 1

.PHONY: build scripts unit-test integration-test
## Build Contracts
build: artifacts/checksums.txt

$(WASMS) artifacts/checksums.txt: $(SOURCE_FILES)
	DOCKER_BUILDKIT=1 docker build --target artifacts -o artifacts .

.PHONY: scripts
## Build Scripts
scripts: scripts/lib

scripts/lib: scripts/node_modules
	cd scripts && npm run build

scripts/node_modules:
	cd scripts && npm ci

.PHONY: unit-test
## Run Linter and Unit Tests
unit-test:
#	cargo clippy
	RUST_BACKTRACE=1 cargo test -- --nocapture

.PHONY: integration-test
## Run Integration Tests
integration-test: build scripts wormhole
	@if pgrep terrad; then echo "Error: terrad already running. Stop it before running tests"; exit 1; fi
	cd LocalTerra && docker compose up --detach
	sleep 5
	cd wormhole/terra/tools && node deploy.js
	cd scripts && node lib/tests/contributor.js || (cd ../LocalTerra && docker compose down && exit 1)
	cd LocalTerra && docker compose down

LocalTerra:
	git clone --depth 1 https://www.github.com/terra-money/LocalTerra

