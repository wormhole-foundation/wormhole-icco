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
        uint16 governanceChainId,
        bytes32 governanceContract
    ) public {
        setChainId(chainId);

        setConductorChainId(conductorChainId);
        setConductorContract(conductorContract);

        setWormhole(wormhole);

        setTokenBridge(tokenBridge);

        setGovernanceChainId(governanceChainId);
        setGovernanceContract(governanceContract);

        _upgradeTo(implementation);
    }
}
