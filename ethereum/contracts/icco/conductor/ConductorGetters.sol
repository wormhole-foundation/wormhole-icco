// contracts/Getters.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IWormhole.sol";
import "../../interfaces/ITokenBridge.sol";

import "./ConductorState.sol";

contract ConductorGetters is ConductorState {
    function owner() public view returns (address) {
        return _state.owner;
    } 

    function isInitialized(address impl) public view returns (bool) {
        return _state.initializedImplementations[impl];
    }

    function wormhole() public view returns (IWormhole) {
        return IWormhole(_state.provider.wormhole);
    }

    function tokenBridge() public view returns (ITokenBridge) {
        return ITokenBridge(payable(_state.provider.tokenBridge));
    }

    function chainId() public view returns (uint16){
        return _state.provider.chainId;
    }

    function consistencyLevel() public view returns (uint8) {
        return _state.consistencyLevel;
    }

    function contributorContracts(uint16 chainId_) public view returns (bytes32){
        return _state.contributorImplementations[chainId_];
    }

    function contributorCustody(uint16 chainId_) public view returns (bytes32){
        return _state.contributorCustody[chainId_];
    }

    function sales(uint saleId_) public view returns (ConductorStructs.Sale memory sale){
        return _state.sales[saleId_];
    }

    function getNextSaleId() public view returns (uint){
        return _state.nextSaleId;
    }

    function saleContributionIsCollected(uint saleId_, uint tokenIndex) public view returns (bool){
        return _state.sales[saleId_].contributionsCollected[tokenIndex];
    }

    function saleContributions(uint saleId_) public view returns (uint[] memory){
        return _state.sales[saleId_].contributions;
    }
}