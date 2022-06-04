#!/bin/bash

cd migrations/
npx truffle migrate --f 2 --to 2 --network goerli --skip-dry-run
npx truffle-migrate --f 3 --to 3 --network goerli --skip-dry-run
npx truffle-migrate --f 3 --to 3 --network fuji --skip-dry-run