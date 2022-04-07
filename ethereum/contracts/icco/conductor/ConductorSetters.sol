// contracts/Setters.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ConductorState.sol";
import "../shared/ICCOStructs.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract ConductorSetters is ConductorState, Context {
    function setOwner(address owner_) internal {
        _state.owner = owner_;
    }

    function setContributor(uint16 chainId, bytes32 emitter) internal {
        _state.contributorImplementations[chainId] = emitter;
    }

    function setInitialized(address implementatiom) internal {
        _state.initializedImplementations[implementatiom] = true;
    }

    function setChainId(uint16 chainId) internal {
        _state.provider.chainId = chainId;
    }

    function setWormhole(address wh) internal {
        _state.provider.wormhole = payable(wh);
    }

    function setTokenBridge(address tb) internal {
        _state.provider.tokenBridge = payable(tb);
    }

    function setSale(uint saleId, ConductorStructs.Sale memory sale) internal {
        _state.sales[saleId] = sale;
    }

    function setSaleContribution(uint saleId, uint tokenIndex, uint contribution) internal {
        _state.sales[saleId].contributions[tokenIndex] = contribution;
        _state.sales[saleId].contributionsCollected[tokenIndex] = true;
    }

    function setSaleSealed(uint saleId) internal {
        _state.sales[saleId].isSealed = true;
    }

    function setSaleAborted(uint saleId) internal {
        _state.sales[saleId].isAborted = true;
    }

    function setRefundClaimed(uint saleId) internal {
        _state.sales[saleId].refundIsClaimed = true;
    }   

    function setNextSaleId(uint nextSaleId) internal {
        _state.nextSaleId = nextSaleId;
    }
}