# ICCO - Initial Cross-Chain Offerings

## Objective

To use the Wormhole message passing protocol to enable trustless cross-chain token sales.

## Background

Token sales are one of the major applications of today's blockchains.
Currently they are either conducted on a single chain in a trustless fashion or in a centralized fashion with support to contribute tokens from multiple chains.
Using wormhole we can bridge this gap - Allow users to contribute assets on all supported chains and issue a token that we can bridge to all chains for them to claim after the sale has been concluded.

## Goals

We want to implement a generalized, trustless cross-chain mechanism for token sales.

- Allow contributions of whitelisted assets on all supported chains
  - Users don't need to maintain multiple wallets, but can conveniently participate from their native environment.
- Issue a token on wormhole chain and leverage the wormhole token bridge to distribute them to all participants on their chains.

## Non-Goals

- Automatically relay messages across chains. The design assumes there is always a party interested in synchronizing the data across chains, let it be the token issuer or an investor who wants to claim its tokens.

## Overview

There are two programs needed to model this.

- A `TokenSaleConductor`, which lives on one chain (It can exist on all chains, however it only needs to be invoked on one to initiate a sale).
  - It holds the tokens that are up for sale and maintains and collects the state around the sale.
- `TokenSaleContributor` contracts live on all chains.
  - Collects contributions, distributes tokens to `TokenSaleContributor` contracts after the sale has ended and the token allocation has been bridged.

These contracts are upgradable with a single key (see **Owner Only** section of each program for relevant methods). We encourage the implementor to use a multisig wallet for deployment at the very least.

## Detailed Design

To create a sale, a user invokes the `createSale()` method on the sale `TokenSaleConductor`. It takes the following set or arguments:

- A `Raise` struct with the following arguments:
  - Boolean to determine if the sale is a fixed-price sale
  - Offered token native address
  - Offered token native chain
  - Offered token amount
  - A start time for when contributions can be accepted
  - An end time for when contributions will no longer be accepted
  - A time for when allocations can be distributed to contributors
  - A minimum USD amount to raise
  - A maximum USD amount to raise
  - The address that can claim the proceeds of the sale
  - The address that should receive the offered tokens in case the minimum raise amount is not met
  - The KYC authority public key
- An array of accepted tokens on each chain + the USD conversion rate which they are accepted at

The `createSale()` method deposits the offered tokens, assigns an ID which identifies the sale and attests a `SaleInit` packet over the wormhole. This packet contains all the information from above. It will also attest a `SolanaSaleInit` packet over the wormhole if any Solana tokens are accepted as collateral in the sale.
The sale information is also stored locally.

The attested `SaleInit` packet (or the `SolanaSaleInit`) is submitted to the `TokenSaleContributor` contracts. The `TokenSaleContributor` contract stores the sale information locally which is relevant to its chain.

The `TokenSaleConductor` contract can terminate the sale by calling `abortSaleBeforeStartTime()` before the sale period begins. Only the wallet that called `createSale()` can invoke this method.

During the start and end timestamp the `TokenSaleContributor` contracts accept contributions in the specified tokens. The `contribute()` method takes an argument `bytes memory sig` which is a third party signature stating that KYC was performed for a particular contribution. The `TokenSaleContributor` calls `verifySignature` to recover a public key from the passed signature. If the public key matches the `authority` address in the `TokenSaleContributor` state, the contribution is permitted. In the case where the KYC `authority` key is compromised, the contract deployer can invoke the `updateSaleAuthority()` method on the `TokenSaleConductor`. An `AuthorityUpdated` packet will be attested over the wormhole, and the `TokensSaleContributor` contracts will update the known `authority` for the specified sale by calling `saleAuthorityUpdated()`.

After the sale duration, anyone can call the `attestContributions()` method on the `TokenSaleContributor`, which attests a `ContributionsSealed` packet over the wormhole. If the sale accepts Solana tokens, the Solana `TokenSaleContributor` will send the `solanaTokenAccount` in the `ContributionsSealed` packet. This tells the `TokenSaleConductor` which account to send the sale tokens to on Solana after the sale is completed.

The `TokenSaleConductor` now collects the `Contributions` packets from all chains & tokens.

After all contributions have been collected, anyone can call the `sealSale()` method on the `TokenSaleConductor`.
The method evaluates whether the minimum raise amount has been met using the conversion rates specified initially (a later version could use rates from an oracle at closing). The conversion rates are scaled based on the accepted token decimals on the `TokenSaleConductor` chain relative to the token decimals on the native chain. It is crucial that the conversion rates are scaled properly in order to correctly calculate token allocations. In case it was successful it:

- Calculates allocations and excess contributions (if total contributions sum to a value larger than the maximum raise amount)
  - Excess contributions are calculated by taking the difference between the maximum raise amount and the total contributions.
    Each contributor receives excess contributions proportional to their contribution amount (individualContribution / totalContributions \* totalExcessContributions)
- Emits a `SaleSealed` packet - indicated to the `TokenSaleContributor` contracts that the sale was successful
- Emits another `SaleSealed` packet if the sale accepts Solana tokens as collateral. The message is in the same format as the original `SaleSealed` packet, but only contains information regarding Solana token allocations. This is necessary due to VAA size contraints on Solana.
- Bridges the relevant share of offered tokens to the `TokenSaleContributor` contracts.
- Refunds the `refundRecipient` sale tokens during a fixed-price sale if the maxRaise parameter is not exceeded.

Or in case the goal was not met, it:

- Emits a `SaleAborted` packet.
- Refunds the sale tokens to the `refundRecipient`

The `TokenSaleContributor` contracts has two functions to consume the relevant attestations:

- `saleSealed()`
  - Starts to accept claims of users acquired tokens via `claimAllocation()`
  - Starts to accept claims of users excess contributions via `claimExcessContribution()`
  - Bridges the raised funds over to the recipient
- `saleAborted()`
  - Starts to accept refund claims via `claimRefund()`

### API / database schema

**TokenSaleConductor**:

- `createSale(ICCOStructs.Raise memory raise, ICCOStructs.Token[] acceptedTokens)`
- `abortSaleBeforeStartTime(uint256 saleId)`
- `collectContribution(vaa ContributionsSealed)`
- `sealSale(uint256 saleId)`
- `abortBrickedSale(uint256 saleId)`
- `saleExists(uint256 saleId)`

Owner Only:

- `updateSaleAuthority(uint256 saleId, address newAuthority, bytes memory sig)`
- `registerChain(uint16 contributorChainId, bytes32 contributorAddress)`
- `upgrade(uint16 conductorChainId, address newImplementation)`
- `updateConsistencyLevel(uint16 conductorChainId, uint8 newConsistencyLevel)`
- `submitOwnershipTransferRequest(uint16 conductorChainId, address newOwner)`
- `confirmOwnershipTransferRequest()`

**TokenSaleContributor**:

- `initSale(vaa SaleInit)`
- `verifySignature(bytes memory encodedHashData, bytes memory sig, address authority)`
- `contribute(uint256 saleId, uint256 tokenIndex, uint256 amount, bytes memory sig)`
- `attestContributions(uint256 saleId)`
- `saleSealed(vaa SaleSealed)`
- `saleAborted(vaa SaleAborted)`
- `claimAllocation(uint256 saleId, uint256 tokenIndex)`
- `claimExcessContribution(uint256 saleId, uint256 tokenIndex)`
- `claimRefund(uint256 saleId, uint256 tokenIndex)`
- `saleAuthorityUpdated(vaa authorityUpdatedVaa)`
- `saleExists(uint256 saleId)`

Owner Only:

- `upgrade(uint16 contributorChainId, address newImplementation)`
- `updateConsistencyLevel(uint16 contributorChainId, uint8 newConsistencyLevel)`
- `submitOwnershipTransferRequest(uint16 conductorChainId, address newOwner)`
- `confirmOwnershipTransferRequest()`

---

**Structs**:

- Token

  - uint16 tokenChain
  - bytes32 tokenAddress
  - uint256 conversionRate

- SolanaToken

  - uint8 tokenIndex
  - bytes32 tokenAddress

- Contribution

  - uint8 tokenIndex (index in accepted tokens array)
  - uint256 contributed

- Allocation

  - uint8 tokenIndex (index in accepted tokens array)
  - uint256 allocation (amount distributed to contributors on this chain)
  - uint256 excessContribution (excess contributions refunded to contributors on this chain)

- Raise

  - bool isFixedPrice (fixed-price sale boolean which determines the sale type)
  - bytes32 token (sale token native address)
  - uint16 tokenChain (sale token native chainId)
  - uint256 tokenAmount (token amount being sold)
  - uint256 minRaise (min raise amount)
  - uint256 maxRaise (max raise amount)
  - uint256 saleStart (timestamp raise start)
  - uint256 saleEnd (timestamp raise end)
  - uint256 unlockTimestamp (timestamp that determines when sale tokens can be claimed)
  - address recipient (recipient of sale proceeds)
  - address refundRecipient (refund recipient in case the sale is aborted)
  - address authority (KYC authority public key)

---

**Payloads**:

SaleInit:

```
// PayloadID uint8 = 1
uint8 payloadID;
// sale ID
uint256 saleID;
// address of the token being sold, left-zero-padded if shorter than 32 bytes
bytes32 tokenAddress;
// chain ID of the token being sold
uint16 tokenChain;
// sale token decimals
uint8 tokenDecimals;
// token amount being sold
uint256 saleStart;
// timestamp raise end
uint256 saleEnd;
// accepted tokens length
uint8 tokensLen;

// repeated for tokensLen times, Struct 'Token'
  // address of the token, left-zero-padded if shorter than 32 bytes
  bytes32 tokenAddress;
  // chain ID of the token
  uint16 tokenChain;
  // conversion rate for the token
  uint256 conversionRate;

// recipient of proceeds
bytes32 recipient;
// KYC authority public key
address authority;
// unlock timestamp (when tokens can be claimed)
uint256 unlockTimestamp
```

ContributionsSealed:

```
// PayloadID uint8 = 2
uint8 payloadID;
// Sale ID
uint256 saleID;
// Chain ID
uint16 chainID;
// Solana ATA (bytes32(0) on non-Solana contributor contracts)
bytes32 solanaTokenAccount;
// Local contributions length
uint8 contributionsLen;

// repeated for tokensLen times, Struct 'Contribution'
  // index in acceptedTokens array
  uint8 tokenIndex;
  // contributed amount of token
  uint256 contributed;
```

SaleSealed:

```
// PayloadID uint8 = 3
uint8 payloadID;
// Sale ID
uint256 saleID;
// local allocations length
uint8 allocationsLen;

// repeated for allocationsLen times, Struct 'Allocation'
  // index in acceptedTokens array
  uint8 index;
  // amount of sold tokens allocated to contributors on this chain
  uint256 allocation;
  // excess contributions refunded to contributors on this chain
  uint256 excessContribution;
```

SaleAborted:

```
// PayloadID uint8 = 4
uint8 payloadID;
// Sale ID
uint256 saleID;
```

SolanaSaleInit:

```
// PayloadID uint8 = 5
uint8 payloadID;
// sale ID
uint256 saleID;
// address of the token - left-zero-padded if shorter than 32 bytes
bytes32 tokenAddress;
// chain ID of the token
uint16 tokenChain;
// token decimals
uint8 tokenDecimals;
// timestamp raise start
uint256 saleStart;
// timestamp raise end
uint256 saleEnd;
// accepted tokens length
uint8 tokensLen;

// repeated for tokensLen times, Struct 'SolanaToken'
  // index in acceptedTokens array
  uint8 tokenIndex;
  // address of the token, left-zero-padded if shorter than 32 bytes
  bytes32 tokenAddress;

// recipient of proceeds
bytes32 recipient;
// KYC authority public key
address authority;
// unlock timestamp (when tokens can be claimed)
uint256 unlockTimestamp
```

AuthorityUpdated:

```
// PayloadID uint8 = 6
uint8 payloadID;
// Sale ID
uint256 saleID;
// Address of new authority
address newAuthority;
```
