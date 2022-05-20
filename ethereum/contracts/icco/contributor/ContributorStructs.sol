// contracts/Structs.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

contract ContributorStructs {
    struct Sale {
        /// sale ID
        uint256 saleID;
        /// address of the token - left-zero-padded if shorter than 32 bytes
        bytes32 tokenAddress;
        /// chain ID of the token
        uint16 tokenChain;
        /// token decimals
        uint8 tokenDecimals;
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

        /// sale token ATA for Solana
        bytes32 solanaTokenAccount;

        /// recipient of proceeds
        bytes32 recipient;
        /// refund recipient in case the sale is aborted
        bytes32 refundRecipient;

        bool isSealed;
        bool isAborted;

        uint256[] allocations;
        uint256[] excessContributions;
    }
}
