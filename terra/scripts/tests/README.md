# Tests

This is a work-in-progress.

## Contributor

Tests will cover the following scenarios in `contributor.ts` (see [whitepaper](../../../WHITEPAPER.md) for details on how the Contributor works).

### Deployment

- [x] Deploy Contract
- [ ] Expect Error when Non-Owner Attempts to Upgrade Contract
- [ ] Upgrade Contract

### Conduct Successful Sale

- [ ] Orchestrator Initializes Sale
- [ ] User Contributes to Sale
- [ ] Orchestrator Attests Contributions
- [ ] Orchestrator Seals Sale
- [ ] User Claims Allocations

### Conduct Aborted Sale

- [ ] Orchestrator Initializes Sale
- [ ] User Contributes to Sale
- [ ] Orchestrator Attests Contributions
- [ ] Orchestrator Aborts Sale
- [ ] User Claims Refunds
