| Code | Contract            | Function                        | Reason                                             |
| ---- | ------------------- | ------------------------------- | -------------------------------------------------- |
| 1    | Conductor           | receiveSaleToken                | wrapped address not found on this chain            |
| 2    | Conductor           | receiveSaleToken                | fee-on-transfer tokens are not supported           |
| 3    | Conductor           | createSale                      | sale start must be in the future                   |
| 4    | Conductor           | createSale                      | sale end must be after sale start                  |
| 5    | Conductor           | createSale                      | unlock timestamp should be >= saleEnd              |
| 6    | Conductor           | createSale                      | unlock timestamp must be <= 2 years in the future  |
| 7    | Conductor           | createSale                      | timestamp too large                                |
| 8    | Conductor           | createSale                      | sale token amount must be > 0                      |
| 9    | Conductor           | createSale                      | must accept at least one token                     |
| 10   | Conductor           | createSale                      | too many tokens                                    |
| 11   | Conductor           | createSale                      | minRaise must be > 0                               |
| 12   | Conductor           | createSale                      | maxRaise must be >= minRaise                       |
| 13   | Conductor           | createSale                      | token must not be bytes32(0)                       |
| 14   | Conductor           | createSale                      | solanaTokenAccount must not be bytes32(0)          |
| 15   | Conductor           | createSale                      | recipient must not be address(0)                   |
| 16   | Conductor           | createSale                      | refundRecipient must not be address(0)             |
| 17   | Conductor           | createSale                      | authority must not be address(0) or the owner      |
| 18   | Conductor           | createSale                      | insufficient value                                 |
| 19   | Conductor           | createSale                      | duplicate tokens not allowed                       |
| 20   | Conductor           | createSale                      | conversion rate cannot be zero                     |
| 21   | Conductor           | createSale                      | acceptedTokens.tokenAddress must not be bytes32(0) |
| 22   | Conductor           | createSale                      | too many solana tokens                             |
| 23   | Conductor           | abortSaleBeforeStartTime        | sale not initiated                                 |
| 24   | Conductor           | abortSaleBeforeStartTime        | only initiator can abort the sale early            |
| 25   | Conductor           | abortSaleBeforeStartTime        | already sealed / aborted                           |
| 26   | Conductor           | abortSaleBeforeStartTime        | sale cannot be aborted once it has started         |
| 27   | Conductor           | abortSaleBeforeStartTime        | insufficient value                                 |
| 28   | Conductor           | collectContribution             | invalid emitter                                    |
| 29   | Conductor           | collectContribution             | contribution from wrong chain id                   |
| 30   | Conductor           | collectContribution             | sale was aborted                                   |
| 31   | Conductor           | collectContribution             | sale has not ended yet                             |
| 32   | Conductor           | collectContribution             | no contributions                                   |
| 33   | Conductor           | collectContribution             | contribution already collected                     |
| 34   | Conductor           | sealSale                        | sale not initiated                                 |
| 35   | Conductor           | sealSale                        | already sealed / aborted                           |
| 36   | Conductor           | sealSale                        | missing contribution info                          |
| 37   | Conductor           | sealSale                        | insufficient value                                 |
| 38   | Conductor           | updateSaleAuthority             | sale not initiated                                 |
| 39   | Conductor           | updateSaleAuthority             | new authority must not be address(0) or the owner  |
| 40   | Conductor           | updateSaleAuthority             | unauthorized authority key                         |
| 41   | Conductor           | updateSaleAuthority             | already sealed / aborted                           |
| 42   | Conductor           | updateSaleAuthority             | incorrect value for messageFee                     |
| 1    | ConductorSetup      | setup                           | wormhole address must not be address(0)            |
| 2    | ConductorSetup      | setup                           | tokenBridge's address must not be address(0)       |
| 3    | ConductorSetup      | setup                           | implementation's address must not be address(0)    |
| 1    | ConductorGovernance | registerChain                   | address not valid                                  |
| 2    | ConductorGovernance | registerChain                   | chain already registered                           |
| 3    | ConductorGovernance | upgrade                         | wrong chain id                                     |
| 4    | ConductorGovernance | updateConsistencyLevel          | wrong chain id                                     |
| 5    | ConductorGovernance | updateConsistencyLevel          | newConsistencyLevel must be > 0                    |
| 6    | ConductorGovernance | submitOwnershipTransferRequest  | wrong chain id                                     |
| 7    | ConductorGovernance | submitOwnershipTransferRequest  | new owner cannot be the zero address               |
| 8    | ConductorGovernance | confirmOwnershipTransferRequest | caller must be pendingOwner                        |
| 9    | ConductorGovernance | onlyOwner                       | caller is not the owner                            |
