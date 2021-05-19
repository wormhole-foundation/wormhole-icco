# Staking and Guardian Election

## Objective

Build a token-based mechanism to elect guardians and enact the updates in fixed epochs.

## Background

Previously, the Wormhole guardian set was controlled by the guardian set itself. With a quorum of 2/3+, the guardians were
able to update the set without any limitations.

With the WORM token being rolled out, we have a governance mechanism to have the users and community of the Wormhole
decide guardians, put their tokens at stake and vouch for participants they deem to be honest and capable.

## Goals

* Staking-based guardian election
* Epoch schedule for guardian updates
* Only update guardian set if the actual set changes

## Non-Goals

* Staking rewards (to be outlined in a separate design doc)
    * Reward distribution mechanism
    * Economics
    * Inflation programs
* Slashing of staked assets (to be outlined in a separate design doc)

## Overview

We extend Serum's staking contracts with a delegation feature and implement guardian ranking on top that will emit a
guardian set update VAA in fixed intervals (epoch boundaries) in case there is a change in the set.

## Detailed Design

We'll use the staking contracts built by the Serum team as a base to implement validator elections /
staking (https://github.com/project-serum/anchor/pull/86). These are currently work in progress, incomplete but have a good 
code quality, so we'll take them as a base layer to implement our own independent staking programs. Staking will solely live on the Solana blockchain.

Currently, these contracts allow staking tokens (both liquid and locked tokens) to be staked. Staking grants you pool
shares which represent your share in the pool (i.e. liquid staking). In order to unstake, a request needs to be made
which will start a waiting period (unstaking period) after which the tokens can be reclaimed. The mechanism is currently
used to airdrop rewards relative to the staked amount.

Our design uses the staking rewards mechanism to distribute inflation and fee rewards of the protocol.

Validators can register using the `registerGuardian` method, which will create a `Guardian` account that tracks their
details and signing keys and allows stakers to elect them into the active set. The authority of the guardian has the
permission to change details (except the signing key). Creating a guardian will also specify a WORM
token-account to receive rewards in. A guardian account can not be deleted.

For each guardian candidate, a staking pool is created. Any tokens staked to the respective guardian's pool will count as
votes for the guardian. The `GuardianRanking` contract will keep a sorted list of the top 19 (i.e. active) guardians by stake.
Individual staking pools per validator make it easier to handle rewards, per-validator slashing while keeping the
components modular and independent.

Since the staking contracts are independent of the `GuardianRanking` contract, there needs to be a synchronization
mechanism. We'll implement that using cranks. Anyone can call `updateGuardianStake`, which will update the ordered list
of guardians. The program will only ever store the top 19 guardians. If a guardian enters the set for a first time with
a stake higher than that of the 19th guardian, the last guardian one will be dropped from the list. Any guardian should
be incentivised to call the crank method regularly in order to maintain their seat (in case someone else with a higher stake 
causes them to drop out of the set but their staking contract has a higher stake than the ranking program knows about).

Once an epoch has passed (every 24h 4pm UTC), the contract will allow anyone to call a "crank" method `advanceEpoch`
that will emit a `GuardianSetUpgrade` VAA in case that the guardian set at the end of the current epoch is different
from that of the last epoch. This crank could also be used to distribute rewards for the given epoch in the future.

The guardians within the active guardian set are ordered by their key so changes in the inner ranking of the active set
don't trigger a set update (and subsequently bump up the set index / invalidate old VAAs).

**Staking Pools**

In order to be able to have validator specific staking pools but still be able to vote in governance using the staked
balance, there needs to be a mechanism for the governance contracts to make users staking WORM tokens in any guardian
staking contract eligible for voting with a weight based on their stake (independent of whether the guardian is in the active set).

Therefore, the following will be implemented:

- StakeFactory / Registry instance that only allows GuardianManager to create new staking pools (by modifying the Serum
  staking / registry contracts). Staking pools will be PDAs (program-derived accounts).
- Governance contract will allow votes from any staking pool (account) owned by StakeFactory (by verifying it's a PDA of
  the StakeFactory).

By separating the StakeFactory and GuardianManager, the StakeFactory will remain reusable by other projects.

### API / database schema

Proposed bridge interface:

Most methods will follow the unmodified staking contract interface except:

**GuardianManager**:

`registerGuardian(string name, string description, address key, address reward_account)` - Register as a guardian
candidate

`updateGuardian(string name, string description, address reward_account)` - Update guardian details

**GuardianRanking**:

`advanceEpoch()` - Trigger an epoch advancement

`updateGuardianStake(StakePool pool)` - Update the stake for a guardian and adjust ranking`

---

**State**:

Guardian:

```rust
struct Guardian {
    name: String,
    description: String,
    staking_pool: Pubkey,
    reward_account: Pubkey,
    consensus_key: [u8; 20]
}
```

GuardianRanking:

```rust
struct State {
    // Sorted list of guardians
    guardians: [RankedGuardian; 20],
    // Last active guardian set
    active_guardian_set: [RankedGuardian; 20],

    // Index of the last guardian set
    guardian_set_index: u32
}


struct RankedGuardian {
    // Tokens staked to the guardian
    stake: u64,
    // Address of the guardian's stake pool
    pool_address: Pubkey,
    // Consensus key of the guardian (cached here to allow easy creation of GuardianSetUpgrade VAAs)
    key: Address,
} 
```

## Caveats

The cranking mechanism requires any guardians and/or their respective delegators to actively watch the chain and execute
transactions to synchronize accounts. There is no guarantee for consistency between the ranking and actual staking
contracts.