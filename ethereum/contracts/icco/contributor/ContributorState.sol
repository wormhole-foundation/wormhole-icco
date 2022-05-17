// contracts/State.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ContributorStructs.sol";

contract ContributorStorage {
    struct Provider {
        uint16 chainId;
        uint16 conductorChainId;
        bytes32 conductorContract;
        address payable wormhole;
        address tokenBridge;
    }

    struct State {
        Provider provider;

        /// deployer of the contracts
        address owner;
        /// kyc public key
        address authority;
        /// number of confirmations for wormhole messages
        uint8 consistencyLevel;

        /// mapping of initialized implementations
        mapping(address => bool) initializedImplementations;

        /// mapping of Sales
        mapping(uint => ContributorStructs.Sale) sales;

        /// sale id > token id > contributor > contribution
        mapping(uint => mapping(uint => mapping(address => uint))) contributions;

        /// sale id > token id > contribution
        mapping(uint => mapping(uint => uint)) totalContributions;

        /// sale id > token id > contributor > isClaimed
        mapping(uint => mapping(uint => mapping(address => bool))) allocationIsClaimed;

        /// sale id > [token id > contributor > isClaimed
        mapping(uint => mapping(uint => mapping(address => bool))) refundIsClaimed;
    }
}

contract ContributorState {
    ContributorStorage.State _state;
}