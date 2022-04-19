// contracts/State.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ContributorStructs.sol";

contract ContributorStorage {
    struct Provider {
        uint16 chainId;

        uint16 governanceChainId;
        bytes32 governanceContract;

        uint16 conductorChainId;
        bytes32 conductorContract;

        address payable wormhole;

        address tokenBridge;
    }

    struct State {
        Provider provider;

        address owner;
        
        address authority;

        // Mapping of consumed governance actions
        mapping(bytes32 => bool) consumedGovernanceActions;

        // Mapping of initialized implementations
        mapping(address => bool) initializedImplementations;

        // Mapping of Sales
        mapping(uint => ContributorStructs.Sale) sales;

        // sale id > token id > contributor > contribution
        mapping(uint => mapping(uint => mapping(address => uint))) contributions;

        // sale id > token id > contribution
        mapping(uint => mapping(uint => uint)) totalContributions;

        // sale id > token id > contributor > isClaimed
        mapping(uint => mapping(uint => mapping(address => bool))) allocationIsClaimed;

        // sale id > [token id > contributor > isClaimed
        mapping(uint => mapping(uint => mapping(address => bool))) refundIsClaimed;
    }
}

contract ContributorState {
    ContributorStorage.State _state;
}