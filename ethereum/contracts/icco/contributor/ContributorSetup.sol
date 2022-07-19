// contracts/ContributorSetup.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "./ContributorGovernance.sol";

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

contract ContributorSetup is ContributorSetters, ERC1967Upgrade {
    function setup(
        address implementation,
        uint16 chainId,
        uint16 conductorChainId,
        bytes32 conductorContract,
        address wormhole,
        address tokenBridge,
        uint8 consistencyLevel
    ) public {
        require(wormhole != address(0), "wormhole address must not be address(0)");
        require(tokenBridge != address(0), "tokenBridge's address must not be address(0)");
        require(conductorContract != bytes32(0), "Conductor's address must not be bytes32(0)");
        require(implementation != address(0), "implementation's address must not be address(0)");
        
        setOwner(_msgSender());

        setChainId(chainId);

        setConductorChainId(conductorChainId);
        setConductorContract(conductorContract);

        setWormhole(wormhole);

        setTokenBridge(tokenBridge);

        setConsistencyLevel(consistencyLevel);

        _upgradeTo(implementation);
    }
}
