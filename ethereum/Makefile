SOURCE_FILES:=$(shell find contracts -name "*.sol")

.PHONY: dependencies test clean all

all: build

node_modules: package-lock.json
	touch -m node_modules
	npm ci

dependencies: node_modules

build: node_modules ${SOURCE_FILES}
	mkdir -p build
	touch -m build
	npm run build

.env: .env.test
	cp $< $@

wormhole/ethereum/build:
	git clone --depth 1 --branch dev.v2 --single-branch https://github.com/certusone/wormhole.git
	cd wormhole/ethereum && npm ci && npm run build && make .env

.PHONY: test
## Run Unit/Integration Test With Ganache CLI
test: .env build wormhole/ethereum/build
	@if pgrep npm; then echo "Error: npm exec ganache-cli already running. Stop it before running tests"; exit 1; fi
	cp -u icco_deployment_config.js.sample icco_deployment_config.js
	npx ganache-cli -e 10000 --deterministic --time="1970-01-01T00:00:00+00:00" > ganache.log &
	sleep 5
	cd wormhole/ethereum && npm run migrate
	npm test || (pkill -f ganache-cli && exit 1)
	pkill -f ganache-cli
	exit 0

.PHONY: tilt-deploy
tilt-deploy: .env build
	@if ! pgrep tilt; then echo "Error: tilt not running. Start it before running tests"; exit 1; fi
	npx truffle migrate --f 2 --to 3 --network eth_devnet
	sed -i 's/CONTRIBUTOR_CHAIN_ID=0x2/CONTRIBUTOR_CHAIN_ID=0x4/g' .env && npx truffle migrate --f 3 --to 3 --network eth_devnet2
	rm -f .env

clean:
	rm -rf ganache.log node_modules build wormhole .env
