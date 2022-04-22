// contracts/Implementation.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./MockContributor2.sol";

contract MockContributorImplementation2 is MockContributor2 {
    function initialize() initializer public virtual {
        // this function needs to be exposed for an upgrade to pass
    }

    modifier initializer() {
        address impl = ERC1967Upgrade._getImplementation();

        require(
            !isInitialized(impl),
            "already initialized"
        );

        setInitialized(impl);

        _;
    }

    function testNewImplementationActive() external pure returns (bool) {
        return true;
    }
}
