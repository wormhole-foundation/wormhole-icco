// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC777/ERC777.sol";

contract TokenERC777 is ERC777{
    address _owner;
    constructor (uint _initSupply, address[] memory defaultOperators) ERC777("TokenERC777", "TOK", defaultOperators) { 
        _owner = msg.sender;
        _mint(msg.sender, _initSupply * (10 ** decimals()), "", "");
    }
    // WARNING: Function "mint" added just for testing purposes in icco.js, it should not appear in production environment
    function mint(address account_, uint256 amount_) public {
        require(_owner == msg.sender, "Not allowed to mint tokens");
        _mint(account_, amount_, "", "");
    }
}