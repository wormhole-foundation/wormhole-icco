// contracts/ConductorSetup.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "./ConductorGovernance.sol";

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

contract ConductorSetup is ConductorSetters, ERC1967Upgrade {
    function setup(
        address implementation,
        uint16 chainId,
        address wormhole,
        address tokenBridge,
        uint8 consistencyLevel
    ) public {
        require(wormhole != address(0), "1");
        require(tokenBridge != address(0), "2");
        require(implementation != address(0), "3");
        
        setOwner(_msgSender());

        setChainId(chainId);

        setWormhole(wormhole);

        setTokenBridge(tokenBridge);

        setConsistencyLevel(consistencyLevel);

        _upgradeTo(implementation);

        /// @dev call initialize function of the new implementation
        (bool success, bytes memory reason) = implementation.delegatecall(abi.encodeWithSignature("initialize()"));
        require(success, string(reason));
    }
}
