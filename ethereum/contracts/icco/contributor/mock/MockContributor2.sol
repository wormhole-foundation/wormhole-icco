// contracts/Contributor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../../../libraries/external/BytesLib.sol";

import "../ContributorGetters.sol";
import "../ContributorSetters.sol";
import "../ContributorStructs.sol";
import "../ContributorGovernance.sol";

import "../../shared/mock/MockICCOStructs.sol";

contract MockContributor2 is ContributorGovernance, ReentrancyGuard {
    function upgradeSuccessful() external pure returns (bool) {
        return true;
    }
}
