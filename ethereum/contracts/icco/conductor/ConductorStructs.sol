// contracts/Structs.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

contract ConductorStructs {
    struct Sale {
        /// sale ID
        uint256 saleID;
        /// native address of the token - left-zero-padded if shorter than 32 bytes
        bytes32 tokenAddress;
        /// native chain ID of the token
        uint16 tokenChain;
        /// decimals of token on conductor chain
        uint8 localTokenDecimals;
        /// address of token on conductor chain
        address localTokenAddress;
        /// sale token ATA for Solana
        bytes32 solanaTokenAccount;
        /// token amount being sold
        uint256 tokenAmount;
        /// min raise amount
        uint256 minRaise;
        /// max raise amount
        uint256 maxRaise;
        /// timestamp raise start
        uint256 saleStart;
        /// timestamp raise end
        uint256 saleEnd;
        /// accepted Tokens
        uint16[] acceptedTokensChains;
        bytes32[] acceptedTokensAddresses;
        uint128[] acceptedTokensConversionRates;
        /// contributions
        uint[] contributions;
        bool[] contributionsCollected;
        /// sale initiator - can abort the sale before saleStart
        address initiator;
        /// recipient of proceeds
        bytes32 recipient;
        /// refund recipient in case the sale is aborted
        bytes32 refundRecipient;
        bool isSealed;
        bool isAborted;
        bool refundIsClaimed;
    }

    struct InternalAccounting {
        /// fees
        uint256 messageFee;
        uint256 valueSent;
        /// token allocation
        uint256 totalContribution;
        uint256 totalAllocated;
        uint256 dust;
        uint256 totalExcessContribution;
    }
}
