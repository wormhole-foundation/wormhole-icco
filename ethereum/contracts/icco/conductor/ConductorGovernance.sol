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
    event ContractUpgraded(address indexed oldContract, address indexed newContract);
    event ConsistencyLevelUpdated(uint8 indexed oldLevel, uint8 indexed newLevel);
    event OwnershipTransfered(address indexed oldOwner, address indexed newOwner);

    /// @dev registerChain serves to save Contributor contract addresses in Conductor state
    function registerChain(uint16 contributorChainId, bytes32 contributorAddress) public onlyOwner {
        require(contributorAddress != bytes32(0), "1");
        require(contributorContracts(contributorChainId) == bytes32(0), "2");
        setContributor(contributorChainId, contributorAddress);
    }   

    /// @dev upgrade serves to upgrade contract implementations
    function upgrade(uint16 conductorChainId, address newImplementation) public onlyOwner {
        require(conductorChainId == chainId(), "3");

        address currentImplementation = _getImplementation();

        _upgradeTo(newImplementation);

        /// @dev call initialize function of the new implementation
        (bool success, bytes memory reason) = newImplementation.delegatecall(abi.encodeWithSignature("initialize()"));

        require(success, string(reason));

        emit ContractUpgraded(currentImplementation, newImplementation);
    }

    /// @dev updateConsisencyLevel serves to change the wormhole messaging consistencyLevel
    function updateConsistencyLevel(uint16 conductorChainId, uint8 newConsistencyLevel) public onlyOwner {
        require(conductorChainId == chainId(), "4");
        require(newConsistencyLevel > 0, "5");

        uint8 currentConsistencyLevel = consistencyLevel();

        setConsistencyLevel(newConsistencyLevel);    

        emit ConsistencyLevelUpdated(currentConsistencyLevel, newConsistencyLevel);
    }

    /**
     * @dev submitOwnershipTransferRequest serves to begin the ownership transfer process of the contracts
     * - it saves an address for the new owner in the pending state
     */
    function submitOwnershipTransferRequest(uint16 conductorChainId, address newOwner) public onlyOwner {
        require(conductorChainId == chainId(), "6");
        require(newOwner != address(0), "7");

        setPendingOwner(newOwner); 
    }

    /**
     * @dev confirmOwnershipTransferRequest serves to finalize an ownership transfer
     * - it checks that the caller is the pendingOwner to validate the wallet address
     * - it updates the owner state variable with the pendingOwner state variable
     */
    function confirmOwnershipTransferRequest() public {
        /// cache the new owner address
        address newOwner = pendingOwner();

        require(msg.sender == newOwner, "8");

        /// cache currentOwner for Event
        address currentOwner = owner();

        /// @dev update the owner in the contract state and reset the pending owner
        setOwner(newOwner);
        setPendingOwner(address(0));

        emit OwnershipTransfered(currentOwner, newOwner); 
    }

    modifier onlyOwner() {
        require(owner() == _msgSender(), "9");
        _;
    }
}