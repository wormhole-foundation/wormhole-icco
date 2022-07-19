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
        require(wormhole != address(0), "wormhole address must not be address(0)");
        require(tokenBridge != address(0), "tokenBridge's address must not be address(0)");
        require(implementation != address(0), "implementation's address must not be address(0)");
        
        setOwner(_msgSender());

        setChainId(chainId);

        setWormhole(wormhole);

        setTokenBridge(tokenBridge);

        setConsistencyLevel(consistencyLevel);

        _upgradeTo(implementation);
    }
}
