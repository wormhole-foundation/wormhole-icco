#!/bin/bash

set -euo pipefail

solana config set --url devnet

# WALLET must be set
ls $WALLET

. devnet.env
solana program deploy target/deploy/anchor_contributor.so -k $WALLET
