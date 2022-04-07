// contracts/State.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ConductorStructs.sol";

contract ConductorStorage {
    struct Provider {
        uint16 chainId;

        uint16 governanceChainId;
        bytes32 governanceContract;

        address payable wormhole;

        address tokenBridge;
    }

    struct State {
        Provider provider;

        address owner;

        // Mapping of consumed governance actions
        mapping(bytes32 => bool) consumedGovernanceActions;

        // Mapping of initialized implementations
        mapping(address => bool) initializedImplementations;

        // Mapping of Conductor contracts on other chains
        mapping(uint16 => bytes32) contributorImplementations;

        // Mapping of Sales
        mapping(uint => ConductorStructs.Sale) sales;

        // Next sale id
        uint256 nextSaleId;
    }
}

contract ConductorState {
    ConductorStorage.State _state;
}