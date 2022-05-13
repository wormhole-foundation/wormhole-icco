# Tests

This is a work-in-progress.

## Contributor

Tests will cover the following scenarios in `contributor.ts` (see [whitepaper](../../../WHITEPAPER.md) for details on how the Contributor works).

### Preparation

- [x] Mint CW20 Mock Token
- [x] Query Balance of Mock Token

### Deployment

- [x] Deploy Contract
- [ ] Non-Owner Cannot Upgrade Contract
- [ ] Upgrade Contract

### Conduct Successful Sale

- [x] 1. Orchestrator Initializes Sale
- [x] 2. Orchestrator Cannot Intialize Sale Again
- [x] 3. User Contributes to Sale (Native)
- [x] 4. User Contributes to Sale (CW20)
- [x] 5. User Cannot Contribute for Non-existent Token Index
- [x] 6. Orchestrator Cannot Attest Contributions Too Early
- [x] 7. User Cannot Contribute After Sale Ended
- [x] 8. Orchestrator Attests Contributions
- [ ] 9. Orchestrator Seals Sale
- [ ] 10. Orchestrator Cannot Seal Sale Again
- [ ] 11. User Claims Allocations
- [ ] 12. User Cannot Claim Allocations Again

### Conduct Aborted Sale

- [x] 1. Orchestrator Initializes Sale
- [x] 2. User Contributes to Sale (Native)
- [x] 3. User Contributes to Sale (CW20)
- [ ] 4. Orchestrator Aborts Sale
- [ ] 5. Orchestrator Cannot Abort Sale Again
- [ ] 6. User Claims Refunds
- [ ] 7. User Cannot Claims Refunds Again
