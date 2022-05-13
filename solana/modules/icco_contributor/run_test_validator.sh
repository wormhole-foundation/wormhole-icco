#/bin/bash

set -euo pipefail

### double-check that we have solana-test-validator cli
which solana-test-validator

### did we build the wormhole contracts?
WORMHOLE=$(dirname $0)/../../../wormhole/solana/artifacts-devnet
ls $WORMHOLE

### how about our contracts?
ICCO=$(dirname $0)/target/deploy
ls $ICCO

### run the test validator with all wormhole programs + icco
solana-test-validator \
    --ledger /tmp/ledger \
    --bpf-program Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o $WORMHOLE/bridge.so \
    --bpf-program B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE $WORMHOLE/token_bridge.so \
    --bpf-program NFTWqJR8YnRVqPDvTJrYuLrQDitTG5AScqbeghi4zSA $WORMHOLE/nft_bridge.so \
    --bpf-program CP1co2QMMoDPbsmV7PGcUTLFwyhgCgTXt25gLQ5LewE1 $WORMHOLE/cpi_poster.so \
    --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s $WORMHOLE/spl_token_metadata.so \
    --bpf-program Ex9bCdVMSfx7EzB3pgSi2R4UHwJAXvTw18rBQm5YQ8gK $WORMHOLE/wormhole_migration.so \
    --bpf-program 22mamxmojFWBdbGqaxTH46HBAgAY2bJRiGJJHfNRNQ95 $ICCO/icco_contributor.so \
    --reset --log