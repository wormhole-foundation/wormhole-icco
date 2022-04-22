// contracts/Conductor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../../libraries/external/BytesLib.sol";

import "../ConductorGetters.sol";
import "../ConductorSetters.sol";
import "../ConductorStructs.sol";
import "../ConductorGovernance.sol";

import "../../shared/mock/MockICCOStructs.sol";

contract MockConductor2 is ConductorGovernance {
    function upgradeSuccessful() external pure returns (bool) {
        return true;
    }
}