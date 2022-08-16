#!/bin/bash

set -euo pipefail

THIS=$(dirname $0)
SDK=${THIS}/..
ANCHOR=${SDK}/../anchor-contributor

# copy idl and anchor-contributor typescript file
SRC=${ANCHOR}/target
DST=${SDK}/target

mkdir -p ${DST}
cp -r ${SRC}/types ${SRC}/idl ${DST}

# copy typescript helper files
SRC=${ANCHOR}/tests/helpers
DST=${SDK}/src/anchor

mkdir -p ${DST}
cp ${SRC}/contributor.ts ${SRC}/kyc.ts ${SRC}/types.ts ${SRC}/utils.ts ${DST}
