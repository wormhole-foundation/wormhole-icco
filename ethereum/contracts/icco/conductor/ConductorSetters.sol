// contracts/Setters.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ConductorState.sol";
import "../shared/ICCOStructs.sol";

contract ConductorSetters is ConductorState {
    function setInitialized(address implementatiom) internal {
        _state.initializedImplementations[implementatiom] = true;
    }

    function setGovernanceActionConsumed(bytes32 hash) internal {
        _state.consumedGovernanceActions[hash] = true;
    }

    function setChainId(uint16 chainId) internal {
        _state.provider.chainId = chainId;
    }

    function setGovernanceChainId(uint16 chainId) internal {
        _state.provider.governanceChainId = chainId;
    }

    function setGovernanceContract(bytes32 governanceContract) internal {
        _state.provider.governanceContract = governanceContract;
    }

    function setContributorImplementation(uint16 chainId, bytes32 contributorContract) internal {
        _state.contributorImplementations[chainId] = contributorContract;
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

    function setContributor(uint16 chainId, bytes32 emitter) internal {
        _state.contributorImplementations[chainId] = emitter;
    }

    function setNextSaleId(uint nextSaleId) internal {
        _state.nextSaleId = nextSaleId;
    }
}