// contracts/Structs.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "../../libraries/external/BytesLib.sol";

contract ICCOStructs {
    using BytesLib for bytes;

    struct Token {
        uint16 tokenChain;
        bytes32 tokenAddress;
        uint256 conversionRate;
    }

    struct Contribution {
        // Index in acceptedTokens array
        uint8 tokenIndex;
        uint256 contributed;
    }

    struct Allocation {
        // Index in acceptedTokens array
        uint8 tokenIndex;
        // amount of sold tokens allocated to contributors on this chain
        uint256 allocation;
    }

    struct SaleInit {
        // PayloadID uint8 = 1
        uint8 payloadID;
        // Sale ID
        uint256 saleID;
        // Address of the token. Left-zero-padded if shorter than 32 bytes
        bytes32 tokenAddress;
        // Chain ID of the token
        uint16 tokenChain;
        // token amount being sold
        uint256 tokenAmount;
        // min raise amount
        uint256 minRaise;
        // timestamp raise start
        uint256 saleStart;
        // timestamp raise end
        uint256 saleEnd;
        // accepted Tokens
        Token[] acceptedTokens;
        // recipient of proceeds
        bytes32 recipient;
        // refund recipient in case the sale is aborted
        bytes32 refundRecipient;
    }

    struct ContributionsSealed {
        // PayloadID uint8 = 2
        uint8 payloadID;
        // Sale ID
        uint256 saleID;
        // Chain ID
        uint16 chainID;
        // sealed contributions for this sale
        Contribution[] contributions;
    }

    struct SaleSealed {
        // PayloadID uint8 = 3
        uint8 payloadID;
        // Sale ID
        uint256 saleID;
        // allocations
        Allocation[] allocations;
    }

    struct SaleAborted {
        // PayloadID uint8 = 4
        uint8 payloadID;
        // Sale ID
        uint256 saleID;
    }

    function encodeSaleInit(SaleInit memory saleInit) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(1),
            saleInit.saleID,
            saleInit.tokenAddress,
            saleInit.tokenChain,
            saleInit.tokenAmount,
            saleInit.minRaise,
            saleInit.saleStart,
            saleInit.saleEnd,
            encodeTokens(saleInit.acceptedTokens),
            saleInit.recipient,
            saleInit.refundRecipient
        );
    }
    function parseSaleInit(bytes memory encoded) public pure returns (SaleInit memory saleInit) {
        uint index = 0;

        saleInit.payloadID = encoded.toUint8(index);
        index += 1;

        require(saleInit.payloadID == 1, "invalid payloadID");

        saleInit.saleID = encoded.toUint256(index);
        index += 32;

        saleInit.tokenAddress = encoded.toBytes32(index);
        index += 32;

        saleInit.tokenChain = encoded.toUint16(index);
        index += 2;

        saleInit.tokenAmount = encoded.toUint256(index);
        index += 32;

        saleInit.minRaise = encoded.toUint256(index);
        index += 32;

        saleInit.saleStart = encoded.toUint256(index);
        index += 32;

        saleInit.saleEnd = encoded.toUint256(index);
        index += 32;

        uint len = 1 + 66 * uint8(encoded[index]);
        saleInit.acceptedTokens = parseTokens(encoded.slice(index, len));
        index += len;

        saleInit.recipient = encoded.toBytes32(index);
        index += 32;

        saleInit.refundRecipient = encoded.toBytes32(index);
        index += 32;

        require(encoded.length == index, "invalid SaleInit");
    }

    function encodeTokens(Token[] memory tokens) public pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(uint8(tokens.length));
        for(uint i = 0; i < tokens.length; i++){
            encoded = abi.encodePacked(
                encoded,
                tokens[i].tokenAddress,
                tokens[i].tokenChain,
                tokens[i].conversionRate
            );
        }
    }
    function parseTokens(bytes memory encoded) public pure returns (Token[] memory tokens) {
        require(encoded.length % 66 == 1, "invalid Token[]");

        uint8 len = uint8(encoded[0]);

        tokens = new Token[](len);

        for(uint i = 0; i < len; i ++) {
            tokens[i].tokenAddress   = encoded.toBytes32(1  + i * 66);
            tokens[i].tokenChain     = encoded.toUint16( 33 + i * 66);
            tokens[i].conversionRate = encoded.toUint256(35 + i * 66);
        }
    }

    function encodeContributionsSealed(ContributionsSealed memory cs) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(2),
            cs.saleID,
            cs.chainID,
            encodeContributions(cs.contributions)
        );
    }
    function parseContributionsSealed(bytes memory encoded) public pure returns (ContributionsSealed memory consSealed) {
        uint index = 0;

        consSealed.payloadID = encoded.toUint8(index);
        index += 1;

        require(consSealed.payloadID == 2, "invalid payloadID");

        consSealed.saleID = encoded.toUint256(index);
        index += 32;

        consSealed.chainID = encoded.toUint16(index);
        index += 2;

        uint len = 1 + 33 * uint8(encoded[index]);
        consSealed.contributions = parseContributions(encoded.slice(index, len));
        index += len;

        require(encoded.length == index, "invalid ContributionsSealed");
    }

    function encodeContributions(Contribution[] memory contributions) public pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(uint8(contributions.length));
        for(uint i = 0; i < contributions.length; i++){
            encoded = abi.encodePacked(
                encoded,
                contributions[i].tokenIndex,
                contributions[i].contributed
            );
        }
    }
    function parseContributions(bytes memory encoded) public pure returns (Contribution[] memory cons) {
        require(encoded.length % 33 == 1, "invalid Contribution[]");

        uint8 len = uint8(encoded[0]);

        cons = new Contribution[](len);

        for(uint i = 0; i < len; i ++) {
            cons[i].tokenIndex  = encoded.toUint8(1 + i * 33);
            cons[i].contributed = encoded.toUint256(2 + i * 33);
        }
    }

    function encodeSaleSealed(SaleSealed memory ss) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(3),
            ss.saleID,
            encodeAllocations(ss.allocations)
        );
    }
    function parseSaleSealed(bytes memory encoded) public pure returns (SaleSealed memory ss) {
        uint index = 0;
        ss.payloadID = encoded.toUint8(index);
        index += 1;

        require(ss.payloadID == 3, "invalid payloadID");

        ss.saleID = encoded.toUint256(index);
        index += 32;

        uint len = 1 + 33 * uint8(encoded[index]);
        ss.allocations = parseAllocations(encoded.slice(index, len));
        index += len;

        require(encoded.length == index, "invalid SaleSealed");
    }

    function encodeAllocations(Allocation[] memory allocations) public pure returns (bytes memory encoded) {
        encoded = abi.encodePacked(uint8(allocations.length));
        for(uint i = 0; i < allocations.length; i++){
            encoded = abi.encodePacked(
                encoded,
                allocations[i].tokenIndex,
                allocations[i].allocation
            );
        }
    }
    function parseAllocations(bytes memory encoded) public pure returns (Allocation[] memory allos) {
        require(encoded.length % 33 == 1, "invalid Allocation[]");

        uint8 len = uint8(encoded[0]);

        allos = new Allocation[](len);

        for(uint i = 0; i < len; i ++) {
            allos[i].tokenIndex = encoded.toUint8(1 + i * 33);
            allos[i].allocation = encoded.toUint256(2 + i * 33);
        }
    }

    function encodeSaleAborted(SaleAborted memory ca) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(4),
            ca.saleID
        );
    }
    function parseSaleAborted(bytes memory encoded) public pure returns (SaleAborted memory sa) {
        uint index = 0;
        sa.payloadID = encoded.toUint8(index);
        index += 1;

        require(sa.payloadID == 4, "invalid payloadID");

        sa.saleID = encoded.toUint256(index);
        index += 32;

        require(encoded.length == index, "invalid SaleAborted");
    }
}