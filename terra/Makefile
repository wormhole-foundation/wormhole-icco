icco_contributor_SOURCE=icco_contributor

SOURCE_FILES=$(shell find . -name "*.rs" -or -name "*.lock" -or -name "*.toml" | grep -v target)

PACKAGES=$(shell find . -name "Cargo.toml" | grep -E 'contracts' | cut -d/ -f3 | sed s/-/_/g)
WASMS=$(patsubst %, artifacts/%.wasm, $(PACKAGES))

-include ../Makefile.help

.PHONY: build
## Build contracts.
build: artifacts/checksums.txt

VALID_mainnet=1
VALID_testnet=1
VALID_devnet=1
.PHONY: check-network
check-network:
ifndef VALID_$(NETWORK)
	$(error Invalid or missing NETWORK. Please call with `$(MAKE) $(MAKECMDGOALS) NETWORK=[mainnet | testnet | devnet]`)
endif

$(WASMS) artifacts/checksums.txt: $(SOURCE_FILES)
	DOCKER_BUILDKIT=1 docker build --target artifacts -o artifacts .

payer-$(NETWORK).json:
	$(error Missing private key in payer-$(NETWORK).json)

.PHONY: deploy/icco_contributor
## Deploy ICCO contributor
deploy/icco_contributor: icco_contributor-code-id-$(NETWORK).txt

%-code-id-$(NETWORK).txt: check-network tools/node_modules payer-$(NETWORK).json
	@echo "Deploying artifacts/$($*_SOURCE).wasm on $(NETWORK)"
	@node tools/deploy_single.js \
		--network $(NETWORK) \
		--artifact artifacts/$($*_SOURCE).wasm \
		--mnemonic "$$(cat payer-$(NETWORK).json)" \
		| grep -i "code id" | sed s/[^0-9]//g \
		> $@
	@echo "Deployed at code id $$(cat $@) (stored in $@)"

tools/node_modules: tools/package-lock.json
	cd tools && npm ci

.PHONY: test
## Run linter and unit tests
test:
#	cargo clippy
	cargo test

.PHONY: clean
clean:
	rm -f $(WASMS) artifacts/checksums.txt tools/node_modules
