// contracts/State.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ConductorStructs.sol";

contract ConductorEvents {
    event EventCreateSale (
        uint256 saleId,
        address creatorAddress
    );

    event EventAbortSaleBeforeStart (
        uint256 saleId
    );

    event EventSealSale (
        uint256 saleId
    );

    event EventAbortSale (
        uint256 saleId
    );
}

contract ConductorStorage {
    struct Provider {
        uint16 chainId;
        address payable wormhole;
        address tokenBridge;
    }

    struct State {
        Provider provider;

        /// contract deployer
        address owner;
        
        /// number of confirmations for wormhole messages
        uint8 consistencyLevel; 

        /// mapping of initialized implementations
        mapping(address => bool) initializedImplementations;

        /// mapping of Conductor contracts on other chains
        mapping(uint16 => bytes32) contributorImplementations;

        /// mapping of Sales
        mapping(uint256 => ConductorStructs.Sale) sales;

        /// next sale id
        uint256 nextSaleId;
    }
}

contract ConductorState {
    ConductorStorage.State _state;
}