#!/bin/bash

set -euo pipefail

THIS=$(dirname $0)
SDK=${THIS}/..
ETHEREUM=${SDK}/../ethereum

npm run build --prefix ${ETHEREUM}
cp -r ${ETHEREUM}/build/contracts ${SDK}/evm-contracts
typechain --target=ethers-v5 --out-dir=${SDK}/src/ethers-contracts evm-contracts/*.json