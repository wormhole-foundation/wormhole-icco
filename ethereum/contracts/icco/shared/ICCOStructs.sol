// contracts/Structs.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "../../libraries/external/BytesLib.sol";

library ICCOStructs {
    using BytesLib for bytes;

    struct Token {
        uint16 tokenChain;
        bytes32 tokenAddress;
        uint128 conversionRate;
    }

    struct SolanaToken {
        uint8 tokenIndex;
        bytes32 tokenAddress;
    }

    struct Contribution {
        /// index in acceptedTokens array
        uint8 tokenIndex;
        uint256 contributed;
    }

    struct Allocation {
        /// index in acceptedTokens array
        uint8 tokenIndex;
        /// amount of sold tokens allocated to contributors on this chain
        uint256 allocation;
        /// excess contributions refunded to contributors on this chain
        uint256 excessContribution;
    }

    struct Raise {
        /// fixed-price sale boolean
        bool isFixedPrice;
        /// sale token address
        bytes32 token;
        /// sale token chainId
        uint16 tokenChain;
        /// token amount being sold
        uint256 tokenAmount;
        /// min raise amount
        uint256 minRaise;
        /// max token amount
        uint256 maxRaise;
        /// timestamp raise start
        uint256 saleStart;
        /// timestamp raise end
        uint256 saleEnd;
        /// unlock timestamp (when tokens can be claimed)
        uint256 unlockTimestamp;
        /// recipient of proceeds
        address recipient;
        /// refund recipient in case the sale is aborted
        address refundRecipient;
        /// public key of kyc authority 
        address authority; 
    }

    struct SaleInit {
        /// payloadID uint8 = 1
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
        /// address of the token - left-zero-padded if shorter than 32 bytes
        bytes32 tokenAddress;
        /// chain ID of the token
        uint16 tokenChain;
        /// token decimals 
        uint8 tokenDecimals;
        /// timestamp raise start
        uint256 saleStart;
        /// timestamp raise end
        uint256 saleEnd;
        /// accepted Tokens
        Token[] acceptedTokens;
        /// recipient of proceeds
        bytes32 recipient;
        /// public key of kyc authority 
        address authority;
        /// unlock timestamp (when tokens can be claimed)
        uint256 unlockTimestamp;
    }

    struct SolanaSaleInit {
        /// payloadID uint8 = 5
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
        /// address of the token - left-zero-padded if shorter than 32 bytes
        bytes32 tokenAddress;
        /// chain ID of the token
        uint16 tokenChain;
        /// token decimals 
        uint8 tokenDecimals;
        /// timestamp raise start
        uint256 saleStart;
        /// timestamp raise end
        uint256 saleEnd;
        /// accepted Tokens
        SolanaToken[] acceptedTokens;  
        /// recipient of proceeds
        bytes32 recipient;
        /// public key of kyc authority 
        address authority;
        /// unlock timestamp (when tokens can be claimed)
        uint256 unlockTimestamp;
    }

    struct ContributionsSealed {
        /// payloadID uint8 = 2
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
        /// chain ID
        uint16 chainID;
        /// solana ATA (bytes32(0) from contributors that aren't on Solana)
        bytes32 solanaTokenAccount;
        /// sealed contributions for this sale
        Contribution[] contributions;
    }

    struct SaleSealed {
        /// payloadID uint8 = 3
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
        /// allocations
        Allocation[] allocations;
    }

    struct SaleAborted {
        /// payloadID uint8 = 4
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
    }

    struct AuthorityUpdated {
        /// payloadID uint8 = 6
        uint8 payloadID;
        /// sale ID
        uint256 saleID;
        /// address of new authority
        address newAuthority; 
    }

    struct WormholeFees {
        /// wormhole messaging fees
        uint256 valueSent;
        uint256 messageFee;
        uint256 accumulatedFees;
        uint256 refundAmount;
        uint8 bridgeCount;
    }

    function normalizeAmount(uint256 amount, uint8 decimals) public pure returns(uint256){
        if (decimals > 8) {
            amount /= 10 ** (decimals - 8);
        }
        return amount;
    }

    function deNormalizeAmount(uint256 amount, uint8 decimals) public pure returns(uint256){
        if (decimals > 8) {
            amount *= 10 ** (decimals - 8);
        }
        return amount;
    }

    function encodeSaleInit(SaleInit memory saleInit) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(1),
            saleInit.saleID,
            saleInit.tokenAddress,
            saleInit.tokenChain,
            saleInit.tokenDecimals,
            saleInit.saleStart,
            saleInit.saleEnd,
            encodeTokens(saleInit.acceptedTokens),
            saleInit.recipient,
            saleInit.authority,
            saleInit.unlockTimestamp
        );
    }

    function encodeSolanaSaleInit(SolanaSaleInit memory solanaSaleInit) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(5),
            solanaSaleInit.saleID,
            solanaSaleInit.tokenAddress,
            solanaSaleInit.tokenChain,
            solanaSaleInit.tokenDecimals,
            solanaSaleInit.saleStart,
            solanaSaleInit.saleEnd,
            encodeSolanaTokens(solanaSaleInit.acceptedTokens),
            solanaSaleInit.recipient,
            solanaSaleInit.authority,
            solanaSaleInit.unlockTimestamp
        );
    }

    function parseSaleInit(bytes memory encoded) public pure returns (SaleInit memory saleInit) {
        uint256 index = 0;

        saleInit.payloadID = encoded.toUint8(index);
        index += 1;

        require(saleInit.payloadID == 1, "invalid payloadID");

        saleInit.saleID = encoded.toUint256(index);
        index += 32;

        saleInit.tokenAddress = encoded.toBytes32(index);
        index += 32;

        saleInit.tokenChain = encoded.toUint16(index);
        index += 2;

        saleInit.tokenDecimals = encoded.toUint8(index);
        index += 1;

        saleInit.saleStart = encoded.toUint256(index);
        index += 32;

        saleInit.saleEnd = encoded.toUint256(index);
        index += 32;

        uint256 len = 1 + 50 * uint256(uint8(encoded[index]));
        saleInit.acceptedTokens = parseTokens(encoded.slice(index, len));
        index += len;

        saleInit.recipient = encoded.toBytes32(index);
        index += 32;

        saleInit.authority = encoded.toAddress(index);
        index += 20;

        saleInit.unlockTimestamp = encoded.toUint256(index);
        index += 32;

        require(encoded.length == index, "invalid SaleInit");
    }

    function encodeTokens(Token[] memory tokens) public pure returns (bytes memory encoded) {
        uint256 tokensLength = tokens.length;
        encoded = abi.encodePacked(uint8(tokensLength));

        for (uint256 i = 0; i < tokensLength;) {
            encoded = abi.encodePacked(
                encoded,
                tokens[i].tokenAddress,
                tokens[i].tokenChain,
                tokens[i].conversionRate
            );
            unchecked { i += 1; }
        }
    }

    function encodeSolanaTokens(SolanaToken[] memory tokens) public pure returns (bytes memory encoded) {
        uint256 tokensLength = tokens.length;
        encoded = abi.encodePacked(uint8(tokensLength));

        for (uint256 i = 0; i < tokensLength;) {
            encoded = abi.encodePacked(
                encoded,
                tokens[i].tokenIndex,
                tokens[i].tokenAddress
            );
            unchecked { i += 1; }
        }
    }

    function parseTokens(bytes memory encoded) public pure returns (Token[] memory tokens) {
        require(encoded.length % 50 == 1, "invalid Token[]");

        uint8 len = uint8(encoded[0]);

        tokens = new Token[](len);

        for (uint256 i = 0; i < len;) {
            tokens[i].tokenAddress   = encoded.toBytes32( 1 + i * 50);
            tokens[i].tokenChain     = encoded.toUint16( 33 + i * 50);
            tokens[i].conversionRate = encoded.toUint128(35 + i * 50);
            unchecked { i += 1; }
        }
    }

    function encodeContributionsSealed(ContributionsSealed memory cs) public pure returns (bytes memory encoded) {
        return abi.encodePacked(
            uint8(2),
            cs.saleID,
            cs.chainID,
            cs.solanaTokenAccount,
            encodeContributions(cs.contributions)
        );
    }

    function parseContributionsSealed(bytes memory encoded) public pure returns (ContributionsSealed memory consSealed) {
        uint256 index = 0;

        consSealed.payloadID = encoded.toUint8(index);
        index += 1;

        require(consSealed.payloadID == 2, "invalid payloadID");

        consSealed.saleID = encoded.toUint256(index);
        index += 32;

        consSealed.chainID = encoded.toUint16(index);
        index += 2;

        consSealed.solanaTokenAccount = encoded.toBytes32(index);
        index += 32;

        uint256 len = 1 + 33 * uint256(uint8(encoded[index]));
        consSealed.contributions = parseContributions(encoded.slice(index, len));
        index += len;

        require(encoded.length == index, "invalid ContributionsSealed");
    }

    function encodeContributions(Contribution[] memory contributions) public pure returns (bytes memory encoded) {
        uint256 contributionsLength = contributions.length;
        encoded = abi.encodePacked(uint8(contributionsLength));

        for (uint256 i = 0; i < contributionsLength;) {
            encoded = abi.encodePacked(
                encoded,
                contributions[i].tokenIndex,
                contributions[i].contributed
            );
            unchecked { i += 1; }
        }
    }

    function parseContributions(bytes memory encoded) public pure returns (Contribution[] memory cons) {
        require(encoded.length % 33 == 1, "invalid Contribution[]");

        uint8 len = uint8(encoded[0]);

        cons = new Contribution[](len);

        for (uint256 i = 0; i < len;) {
            cons[i].tokenIndex  = encoded.toUint8(1 + i * 33);
            cons[i].contributed = encoded.toUint256(2 + i * 33);
            unchecked { i += 1; }
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
        uint256 index = 0;
        ss.payloadID = encoded.toUint8(index);
        index += 1;

        require(ss.payloadID == 3, "invalid payloadID");

        ss.saleID = encoded.toUint256(index);
        index += 32;

        uint256 len = 1 + 65 * uint256(uint8(encoded[index]));
        ss.allocations = parseAllocations(encoded.slice(index, len));
        index += len;

        require(encoded.length == index, "invalid SaleSealed");
    }

    function encodeAllocations(Allocation[] memory allocations) public pure returns (bytes memory encoded) {
        uint256 allocationsLength = allocations.length;
        encoded = abi.encodePacked(uint8(allocationsLength));

        for (uint256 i = 0; i < allocationsLength;) {
            encoded = abi.encodePacked(
                encoded,
                allocations[i].tokenIndex,
                allocations[i].allocation,
                allocations[i].excessContribution
            );
            unchecked { i += 1; }
        }
    }

    function parseAllocations(bytes memory encoded) public pure returns (Allocation[] memory allos) {
        require(encoded.length % 65 == 1, "invalid Allocation[]");

        uint8 len = uint8(encoded[0]);

        allos = new Allocation[](len);

        for (uint256 i = 0; i < len;) {
            allos[i].tokenIndex = encoded.toUint8(1 + i * 65);
            allos[i].allocation = encoded.toUint256(2 + i * 65);
            allos[i].excessContribution = encoded.toUint256(34 + i * 65);
            unchecked { i += 1; }
        }
    }

    function encodeSaleAborted(SaleAborted memory ca) public pure returns (bytes memory encoded) {
        return abi.encodePacked(uint8(4), ca.saleID);
    } 

    function parseSaleAborted(bytes memory encoded) public pure returns (SaleAborted memory sa) {
        uint256 index = 0;
        sa.payloadID = encoded.toUint8(index);
        index += 1;

        require(sa.payloadID == 4, "invalid payloadID");

        sa.saleID = encoded.toUint256(index);
        index += 32;

        require(encoded.length == index, "invalid SaleAborted");
    }

     function encodeAuthorityUpdated(AuthorityUpdated memory update) public pure returns (bytes memory encoded) {
        return abi.encodePacked(uint8(6), update.saleID, update.newAuthority);
    }

    function parseAuthorityUpdated(bytes memory encoded) public pure returns (AuthorityUpdated memory update) {
        uint256 index = 0;
        update.payloadID = encoded.toUint8(index);
        index += 1;

        require(update.payloadID == 6, "invalid payloadID");

        update.saleID = encoded.toUint256(index);
        index += 32;

        update.newAuthority = encoded.toAddress(index);
        index += 20; 

        require(encoded.length == index, "invalid AuthorityUpdated");
    }

    /// @dev duplicate method from Contributor.sol 
    function verifySignature(bytes memory encodedHashData, bytes memory sig, address authority) public pure returns (bool) {
        require(sig.length == 65, "incorrect signature length"); 
        require(encodedHashData.length > 0, "no hash data");

        /// compute hash from encoded data
        bytes32 hash_ = keccak256(encodedHashData);  
        
        /// parse v, r, s
        uint8 index = 0;

        bytes32 r = sig.toBytes32(index);
        index += 32;

        bytes32 s = sig.toBytes32(index);
        index += 32;

        uint8 v = sig.toUint8(index) + 27;

        /// recovered key
        address key = ecrecover(hash_, v, r, s);

        /// confirm that the recovered key is the authority
        if (key == authority) {
            return true;
        } else {
            return false;
        }
    }
}