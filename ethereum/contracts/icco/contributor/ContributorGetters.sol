// contracts/Getters.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/IWormhole.sol";
import "../../interfaces/ITokenBridge.sol";

import "./ContributorState.sol";

contract ContributorGetters is ContributorState {
    function owner() public view returns (address) {
        return _state.owner;
    }

    function authority() public view returns (address) {
        return _state.authority;
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

    function consistencyLevel() public view returns (uint8) {
        return _state.consistencyLevel;
    }

    function chainId() public view returns (uint16){
        return _state.provider.chainId;
    }

    function conductorChainId() public view returns (uint16){
        return _state.provider.conductorChainId;
    }

    function conductorContract() public view returns (bytes32){
        return _state.provider.conductorContract;
    }

    function sales(uint saleId_) public view returns (ContributorStructs.Sale memory sale){
        return _state.sales[saleId_];
    }

    function getSaleAcceptedTokenInfo(uint saleId_, uint tokenIndex) public view returns (uint16 tokenChainId, bytes32 tokenAddress, uint128 conversionRate){
        return (
            _state.sales[saleId_].acceptedTokensChains[tokenIndex],
            _state.sales[saleId_].acceptedTokensAddresses[tokenIndex],
            _state.sales[saleId_].acceptedTokensConversionRates[tokenIndex]
        );
    }

    function getSaleTimeframe(uint saleId_) public view returns (uint256 start, uint256 end){
        return (
            _state.sales[saleId_].saleStart,
            _state.sales[saleId_].saleEnd
        );
    }

    function getSaleStatus(uint saleId_) public view returns (bool isSealed, bool isAborted){
        return (
            _state.sales[saleId_].isSealed,
            _state.sales[saleId_].isAborted
        );
    }

    function getSaleTokenAddress(uint saleId_) public view returns (bytes32 tokenAddress){
        tokenAddress = _state.sales[saleId_].tokenAddress;
    }

    function getSaleAllocation(uint saleId, uint tokenIndex) public view returns (uint256 allocation){
        return _state.sales[saleId].allocations[tokenIndex];
    }

    function getSaleExcessContribution(uint saleId, uint tokenIndex) public view returns (uint256 allocation){
        return _state.sales[saleId].excessContributions[tokenIndex];
    }

    function getSaleTotalContribution(uint saleId, uint tokenIndex) public view returns (uint256 contributed){
        return _state.totalContributions[saleId][tokenIndex];
    }

    function getSaleContribution(uint saleId, uint tokenIndex, address contributor) public view returns (uint256 contributed){
        return _state.contributions[saleId][tokenIndex][contributor];
    }

    function refundIsClaimed(uint saleId, uint tokenIndex, address contributor) public view returns (bool){
        return _state.refundIsClaimed[saleId][tokenIndex][contributor];
    }

    function allocationIsClaimed(uint saleId, uint tokenIndex, address contributor) public view returns (bool){
        return _state.allocationIsClaimed[saleId][tokenIndex][contributor];
    }
}