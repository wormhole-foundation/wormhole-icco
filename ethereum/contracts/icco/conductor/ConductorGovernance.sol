// contracts/Conductor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

import "../../libraries/external/BytesLib.sol";

import "./ConductorGetters.sol";
import "./ConductorSetters.sol";
import "./ConductorStructs.sol";

import "../../interfaces/IWormhole.sol";

contract ConductorGovernance is ConductorGetters, ConductorSetters, ERC1967Upgrade {
    // register contributor contract
    function registerChain(uint16 contributorChainId, bytes32 contributorAddress) public onlyOwner {
        require(contributorContracts(contributorChainId) == bytes32(0), "chain already registered");
        setContributor(contributorChainId, contributorAddress);
    }  

    event ContractUpgraded(address indexed oldContract, address indexed newContract);

    function upgrade(uint16 conductorChainId, address newImplementation) public onlyOwner {
        require(conductorChainId == chainId(), "wrong chain id");

        address currentImplementation = _getImplementation();

        _upgradeTo(newImplementation);

        // Call initialize function of the new implementation
        (bool success, bytes memory reason) = newImplementation.delegatecall(abi.encodeWithSignature("initialize()"));

        require(success, string(reason));

        emit ContractUpgraded(currentImplementation, newImplementation);
    }

    modifier onlyOwner() {
        require(owner() == _msgSender(), "caller is not the owner");
        _;
    }
}