// contracts/Setters.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ContributorState.sol";
import "../shared/ICCOStructs.sol";

contract ContributorSetters is ContributorState {
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

    function setConductorChainId(uint16 chainId) internal {
        _state.provider.conductorChainId = chainId;
    }

    function setConductorContract(bytes32 conductorContract) internal {
        _state.provider.conductorContract = conductorContract;
    }

    function setWormhole(address wh) internal {
        _state.provider.wormhole = payable(wh);
    }

    function setTokenBridge(address tb) internal {
        _state.provider.tokenBridge = payable(tb);
    }

    function setSale(uint saleId, ContributorStructs.Sale memory sale) internal {
        _state.sales[saleId] = sale;
    }

    function setSaleContribution(uint saleId, address contributor, uint tokenIndex, uint contribution) internal {
        _state.contributions[saleId][tokenIndex][contributor] += contribution;
        _state.totalContributions[saleId][tokenIndex] += contribution;
    }

    function setSaleSealed(uint saleId) internal {
        _state.sales[saleId].isSealed = true;
    }

    function setSaleAborted(uint saleId) internal {
        _state.sales[saleId].isAborted = true;
    }

    function setRefundClaimed(uint saleId, uint tokenIndex, address contributor) internal {
        _state.refundIsClaimed[saleId][tokenIndex][contributor] = true;
    }

    function setAllocationClaimed(uint saleId, uint tokenIndex, address contributor) internal {
        _state.allocationIsClaimed[saleId][tokenIndex][contributor] = true;
    }

    function setSaleAllocation(uint saleId, uint tokenIndex, uint allocation) internal {
        _state.sales[saleId].allocations[tokenIndex] = allocation;
    }
}