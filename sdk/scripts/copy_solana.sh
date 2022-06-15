#!/bin/bash

THIS=$(dirname $0)


# copy idl and anchor-contributor typescript file
SRC=${THIS}/../../anchor-contributor/target
DST=${THIS}/../src/target

mkdir -p ${DST}
cp -r ${SRC}/types ${DST}
cp -r ${SRC}/idl ${THIS}/../solana-idl

# copy typescript helper files
SRC=${THIS}/../../anchor-contributor/tests/helpers
DST=${THIS}/../src/solana/copied

mkdir -p ${DST}
cp ${SRC}/accounts.ts ${SRC}/contributor.ts ${SRC}/fetch.ts ${SRC}/kyc.ts ${SRC}/types.ts ${SRC}/utils.ts ${DST}

cp -r ${THIS}/../anchor-contributor/target/idl ./solana-idl