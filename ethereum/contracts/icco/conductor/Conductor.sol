// contracts/Conductor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../../libraries/external/BytesLib.sol";

import "./ConductorGetters.sol";
import "./ConductorSetters.sol";
import "./ConductorStructs.sol";
import "./ConductorGovernance.sol";

import "../shared/ICCOStructs.sol";

/** 
 * @title A cross-chain token sale conductor
 * @notice This contract manages cross-chain token sales. It uses the wormhole 
 * core messaging layer to communicate token sale information to linked Contributor 
 * contracts. For successful sales, it uses the wormhole token bridge to 
 * send the sale token to Contributor contracts in exchange for contributed funds. 
 * For unsuccessful sales, this contract will return the sale tokens to a 
 * specified recipient address.
 */ 
contract Conductor is ConductorGovernance, ConductorEvents, ReentrancyGuard {
    /**
     * @dev receiveSaleToken serves to take custody of the sale token and 
     * returns information about the token on the Conductor chain.
     * - it transfers the sale tokens to this contract
     * - it finds the address of the token on the Conductor chain
     * - it finds the ERC20 token decimals of the token on the Conductor chain
     */
    function receiveSaleToken(
        ICCOStructs.Raise memory raise
    ) internal returns (address, uint8) {
        /// @dev grab the local token address (address of sale token on conductor chain)
        address localTokenAddress;
        if (raise.tokenChain == chainId()) {
            localTokenAddress = address(uint160(uint256(raise.token)));
        } else {
            /// identify wormhole token bridge wrapper
            localTokenAddress = tokenBridge().wrappedAsset(raise.tokenChain, raise.token);  
            require(localTokenAddress != address(0), "1"); 
        }

        /** 
         * @dev Fetch the sale token decimals on this chain.
         * The Contributors need to know this to scale allocations on non-evm chains.            
         */ 
        (,bytes memory queriedDecimals) = localTokenAddress.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        uint8 localTokenDecimals = abi.decode(queriedDecimals, (uint8));

        /// query own token balance before transfer
        (,bytes memory queriedBalanceBefore) = localTokenAddress.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, 
            address(this))
        );
        uint256 balanceBefore = abi.decode(queriedBalanceBefore, (uint256));

        /// deposit sale tokens
        SafeERC20.safeTransferFrom(
            IERC20(localTokenAddress), 
            msg.sender, 
            address(this), 
            raise.tokenAmount
        );

        /// query own token balance after transfer
        (,bytes memory queriedBalanceAfter) = localTokenAddress.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, 
            address(this))
        );
        uint256 balanceAfter = abi.decode(queriedBalanceAfter, (uint256));

        /// revert if token has fee
        require(raise.tokenAmount == balanceAfter - balanceBefore, "2");

        return (localTokenAddress, localTokenDecimals);
    }

    /**
     * @dev createSale serves to initialize a cross-chain token sale and disseminate 
     * information about the sale to registered Contributor contracts.
     * - it validates sale parameters passed in by the client
     * - it saves a copy of the sale in contract storage
     * - it encodes and disseminates sale information to Contributor contracts via wormhole
     */
    function createSale(
        ICCOStructs.Raise memory raise,
        ICCOStructs.Token[] memory acceptedTokens   
    ) public payable nonReentrant returns (
        uint256 saleId,
        uint256 wormholeSequence,
        uint256 wormholeSequence2
    ) {
        /// validate sale parameters from client
        require(block.timestamp < raise.saleStart, "3");
        require(raise.saleStart < raise.saleEnd, "4");
        require(raise.unlockTimestamp >= raise.saleEnd, "5");
        require(raise.unlockTimestamp - raise.saleEnd <= 63072000, "6");
        /// set timestamp cap for non-evm Contributor contracts
        require(raise.unlockTimestamp <= 2**63-1, "7");
        /// sanity check other raise parameters
        require(raise.tokenAmount > 0 && raise.tokenAmount <= 2**63-1, "8");
        require(acceptedTokens.length > 0, "9");
        require(acceptedTokens.length < 255, "10");
        require(raise.minRaise > 0, "11");
        require(raise.maxRaise >= raise.minRaise, "12");
        require(raise.token != bytes32(0), "13");
        require(raise.recipient != address(0), "14");
        require(raise.refundRecipient != address(0), "15");
        /// confirm that sale authority is set properly
        require(raise.authority != address(0) && raise.authority != owner(), "16");

        /// cache wormhole instance 
        IWormhole wormhole = wormhole();

        /// wormhole fees accounting
        ICCOStructs.WormholeFees memory feeAccounting;
        feeAccounting.messageFee = wormhole.messageFee();
        feeAccounting.valueSent = msg.value;

        /// make sure the caller has sent enough eth to cover message fees
        require(feeAccounting.valueSent >= 2 * feeAccounting.messageFee, "17");

        /// @dev take custody of sale token and fetch decimal/address info for the sale token
        (address localTokenAddress, uint8 localTokenDecimals) = receiveSaleToken(raise);

        /// @dev cache to save on gas (referenced several times)
        uint256 acceptedTokensLength = acceptedTokens.length;
        
        /// create Sale struct for Conductor's view of the sale
        saleId = useSaleId();
        ConductorStructs.Sale memory sale = ConductorStructs.Sale({
            saleID : saleId,
            /// client sale parameters
            tokenAddress : raise.token,
            tokenChain : raise.tokenChain,
            localTokenDecimals: localTokenDecimals,
            localTokenAddress: localTokenAddress, 
            /// @dev placeholder for solana ATA - this is sent from the Solana contributor   
            solanaTokenAccount: bytes32(0),
            tokenAmount : raise.tokenAmount,
            minRaise: raise.minRaise,
            maxRaise: raise.maxRaise,
            saleStart : raise.saleStart,
            saleEnd : raise.saleEnd,
            unlockTimestamp : raise.unlockTimestamp,
            /// save accepted token info
            acceptedTokensChains : new uint16[](acceptedTokensLength),
            acceptedTokensAddresses : new bytes32[](acceptedTokensLength),
            acceptedTokensConversionRates : new uint128[](acceptedTokensLength),
            solanaAcceptedTokensCount: 0,
            contributions : new uint256[](acceptedTokensLength),
            contributionsCollected : new bool[](acceptedTokensLength),
            /// sale wallet management 
            initiator : msg.sender, 
            recipient : bytes32(uint256(uint160(raise.recipient))),
            refundRecipient : bytes32(uint256(uint160(raise.refundRecipient))),
            /// public key of kyc authority 
            authority: raise.authority,
            /// sale identifiers
            isSealed :  false,
            isAborted : false,
            isFixedPrice : raise.isFixedPrice
        });

        /// populate the accepted token arrays
        for (uint256 i = 0; i < acceptedTokensLength;) {
            /// @dev make sure there are no duplicate accepted tokens
            for (uint256 j = 0; j < i;) {
                require(
                    sale.acceptedTokensChains[j] != acceptedTokens[i].tokenChain || 
                    sale.acceptedTokensAddresses[j] != acceptedTokens[i].tokenAddress, 
                    "18"
                );
                unchecked { j += 1; }
            }

            /// @dev sanity check accepted tokens
            require(acceptedTokens[i].conversionRate > 0, "19");
            require(acceptedTokens[i].tokenAddress != bytes32(0), "20");

            /// add the unique accepted token information
            sale.acceptedTokensChains[i] = acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = acceptedTokens[i].conversionRate;

            /// store the accepted tokens for the SolanaSaleInit VAA
            if (acceptedTokens[i].tokenChain == 1) {
                ICCOStructs.SolanaToken memory solanaToken = ICCOStructs.SolanaToken({
                    tokenIndex: uint8(i),
                    tokenAddress: acceptedTokens[i].tokenAddress
                });
                /// only allow 8 accepted tokens for the Solana Contributor
                require(_state.solanaAcceptedTokens.length < 8, "21");
                /// save in contract storage
                _state.solanaAcceptedTokens.push(solanaToken);
            }
            unchecked { i += 1; }
        }

        /// save number of accepted solana tokens in the sale
        sale.solanaAcceptedTokensCount = uint8(_state.solanaAcceptedTokens.length);

        /// store sale info
        setSale(saleId, sale); 

        /// create SaleInit struct to disseminate to Contributors
        ICCOStructs.SaleInit memory saleInit = ICCOStructs.SaleInit({
            payloadID : 1,
            /// sale ID
            saleID : saleId,
            /// address of the token, left-zero-padded if shorter than 32 bytes
            tokenAddress : raise.token,
            /// chain ID of the token
            tokenChain : raise.tokenChain,
            /// token decimals
            tokenDecimals: localTokenDecimals,
            /// timestamp raise start
            saleStart : raise.saleStart,
            /// timestamp raise end
            saleEnd : raise.saleEnd,
            /// accepted Tokens
            acceptedTokens : acceptedTokens,
            /// recipient of proceeds
            recipient : bytes32(uint256(uint160(raise.recipient))),
            /// public key of kyc authority 
            authority : raise.authority,
            /// unlock timestamp (when tokens can be claimed)
            unlockTimestamp : raise.unlockTimestamp
        }); 

        /// @dev send encoded SaleInit struct to Contributors via wormhole.        
        wormholeSequence = wormhole.publishMessage{
            value : feeAccounting.messageFee
        }(0, ICCOStructs.encodeSaleInit(saleInit), consistencyLevel());

        /// increment message fees
        feeAccounting.accumulatedFees += feeAccounting.messageFee;

        /// see if the sale accepts any Solana tokens
        if (sale.solanaAcceptedTokensCount > 0) {
            /// create SolanaSaleInit struct to disseminate to the Solana Contributor
            ICCOStructs.SolanaSaleInit memory solanaSaleInit = ICCOStructs.SolanaSaleInit({
                payloadID : 5,
                /// sale ID
                saleID : saleId,
                /// address of the token, left-zero-padded if shorter than 32 bytes 
                tokenAddress: raise.token,
                /// chain ID of the token
                tokenChain : raise.tokenChain,
                /// token decimals
                tokenDecimals: localTokenDecimals,
                /// timestamp raise start
                saleStart : raise.saleStart,
                /// timestamp raise end
                saleEnd : raise.saleEnd,
                /// accepted Tokens
                acceptedTokens : _state.solanaAcceptedTokens,
                /// recipient of proceeds
                recipient : bytes32(uint256(uint160(raise.recipient))),
                /// public key of kyc authority 
                authority: raise.authority,
                /// unlock timestamp (when tokens can be claimed)
                unlockTimestamp : raise.unlockTimestamp
            });

            /// @dev send encoded SolanaSaleInit struct to the solana Contributor
            wormholeSequence2 = wormhole.publishMessage{
                value : feeAccounting.messageFee
            }(0, ICCOStructs.encodeSolanaSaleInit(solanaSaleInit), consistencyLevel());   

            /// increment message fees
            feeAccounting.accumulatedFees += feeAccounting.messageFee; 

            /// @dev garbage collection to save on gas fees
            delete _state.solanaAcceptedTokens;
        }

        /// @dev refund the caller any extra wormhole fees
        feeAccounting.refundAmount = feeAccounting.valueSent - feeAccounting.accumulatedFees;        
        if (feeAccounting.refundAmount > 0) payable(msg.sender).transfer(feeAccounting.refundAmount);

        /// emit EventCreateSale event.
        emit EventCreateSale(saleInit.saleID, msg.sender);
    }

    /**
     * @dev abortSaleBeforeStartTime serves to allow the sale initiator to 
     * cancel the sale before the saleStart time.
     * - it confirms that the sale has not started
     * - it only allows the sale initiator to invoke the method
     * - it encodes and disseminates a saleAborted message to the Contributor contracts
     * - it refunds the sale tokens to the refundRecipient
     */    
    function abortSaleBeforeStartTime(uint256 saleId) public payable returns (uint256 wormholeSequence) {
        require(saleExists(saleId), "22");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// confirm that caller is the sale initiator
        require(sale.initiator == msg.sender, "23");

        /// make sure that the sale is still valid and hasn't started yet
        require(!sale.isSealed && !sale.isAborted, "24");
        require(block.timestamp < sale.saleStart, "25");

        /// set saleAborted
        setSaleAborted(sale.saleID);   

        IWormhole wormhole = wormhole();
        uint256 messageFee = wormhole.messageFee();
        require(msg.value == messageFee, "26");

        /// @dev send encoded SaleAborted struct to Contributor contracts        
        wormholeSequence = wormhole.publishMessage{
            value : messageFee
        }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
            payloadID : 4,
            saleID : saleId
        })), consistencyLevel());

        /// @dev refund the sale tokens to refund recipient
        SafeERC20.safeTransfer(
            IERC20(sale.localTokenAddress), 
            address(uint160(uint256(sale.refundRecipient))), 
            sale.tokenAmount 
        );

        /// emit EventAbortSaleBeforeStart event.
        emit EventAbortSaleBeforeStart(saleId);
    }

    /**
     * @dev collectContribution serves to accept contribution information
     * disseminated by each registered Contributor contract.
     * - it sets the solanaTokenAccount when consuming contributions from the Solana contributor
     */ 
    function collectContribution(bytes memory encodedVm) public {
        /// validate encodedVm and emitter
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(verifyContributorVM(vm), "27");

        /// parse the ContributionsSealed struct emitted by a Contributor contract
        ICCOStructs.ContributionsSealed memory conSealed = ICCOStructs.parseContributionsSealed(vm.payload);

        require(conSealed.chainID == vm.emitterChainId, "28");

        /// make sure the sale has ended before accepting contribution information
        ConductorStructs.Sale memory sale = sales(conSealed.saleID);

        require(!sale.isAborted, "29");
        require(block.timestamp > sale.saleEnd, "30");

        /// cache because it's referenced several times
        uint256 contributionsLength = conSealed.contributions.length; 

        // confirm that contribution information is valid and that it hasn't been collected for this Contributor
        require(contributionsLength > 0, "31");
        require(!saleContributionIsCollected(
            conSealed.saleID, conSealed.contributions[0].tokenIndex), 
            "32"
        );

        /// @dev set the solanaTokenAccount when consuming a Solana ContributionsSealed
        if (conSealed.chainID == 1) {
            setSolanaTokenAccount(conSealed.saleID, conSealed.solanaTokenAccount);
        }

        /// save the total contribution amount for each accepted token 
        for (uint256 i = 0; i < contributionsLength;) {
            setSaleContribution(
                conSealed.saleID,
                conSealed.contributions[i].tokenIndex,
                conSealed.contributions[i].contributed
            );
            unchecked { i += 1; }
        }
    }

    /**
     * @dev sealSale serves to determine if a sale was successful or not. 
     * - it calculates the total amount raised in the sale
     * - it determines if the sale was a success by comparing the total to minRaise
     * - it calculates allocations and excess contributions for each accepted token
     * - it disseminates a saleSealed or saleAborted message to Contributors via wormhole
     * - it bridges the sale tokens to the contributor contracts if sealed
     * - it refunds the refundRecipient if the sale is aborted or the maxRaise is not met (partial refund)
     */
    function sealSale(uint256 saleId) public payable nonReentrant returns (uint256 wormholeSequence, uint256 wormholeSequence2) {
        require(saleExists(saleId), "33");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// make sure the sale hasn't been aborted or sealed already
        require(!sale.isSealed && !sale.isAborted, "34");

        ConductorStructs.SealSaleAccounting memory accounting;       
        ICCOStructs.WormholeFees memory feeAccounting; 

        /// cache accepted tokens length, it will be used in several for loops
        uint256 acceptedTokensLength = sale.acceptedTokensAddresses.length;
        for (uint256 i = 0; i < acceptedTokensLength;) {
            require(saleContributionIsCollected(saleId, i), "35");
            /**
            * @dev This calculates the total contribution for each accepted token.
            * - it uses the conversion rate to convert contributions into the minRaise denomination
            */
            accounting.totalContribution += sale.contributions[i] * sale.acceptedTokensConversionRates[i]; 

            /// @dev count how many token bridge transfer will occur in sealSale 
            if (sale.acceptedTokensChains[i] != chainId()) {
                feeAccounting.bridgeCount += 1;
            }
            unchecked { i += 1; } 
        }
        accounting.totalContribution /= 1e18;
        
        /// cache wormhole instance set fees in feeAccounting struct 
        IWormhole wormhole = wormhole();
        feeAccounting.messageFee = wormhole.messageFee();
        feeAccounting.valueSent = msg.value;

        /// @dev msg.value must cover all token bridge transfer fees + two saleSealed messages
        require(feeAccounting.valueSent >= feeAccounting.messageFee * (feeAccounting.bridgeCount + 2), "36");

        /// check to see if the sale was successful
        if (accounting.totalContribution >= sale.minRaise) {
            /// set saleSealed
            setSaleSealed(saleId);

            /// cache token bridge instance
            ITokenBridge tknBridge = tokenBridge();

            /**
             * @dev This determines if contributors (or the sale initiator) qualify for refund payments.
             * - the default value for accounting.excessContribution is zero
             * - if totalContribution > maxRaise, the difference between maxRaise and totalContribution 
             * is the total reward due to contributors
             * - if the totalContribution < maxRaise or the isFixedPrice flag is set to true, 
             * the saleRecipient will receive a partial refund of the sale token
             */

            accounting.adjustedSaleTokenAmount = sale.tokenAmount; 
            if (accounting.totalContribution > sale.maxRaise) {
                accounting.totalExcessContribution = accounting.totalContribution - sale.maxRaise;
            } else if (sale.isFixedPrice) {
                accounting.adjustedSaleTokenAmount = sale.tokenAmount * accounting.totalContribution / sale.maxRaise;
            }

            /// @dev This is a successful sale struct that saves sale token allocation information
            ICCOStructs.SaleSealed memory saleSealed = ICCOStructs.SaleSealed({
                payloadID : 3,
                saleID : saleId,
                allocations : new ICCOStructs.Allocation[](acceptedTokensLength)
            });

            /// calculate allocations and excessContributions for each accepted token  
            for (uint256 i = 0; i < acceptedTokensLength;) {
                accounting.allocation = accounting.adjustedSaleTokenAmount * (sale.contributions[i] * sale.acceptedTokensConversionRates[i] / 1e18) / accounting.totalContribution;
                accounting.excessContribution = accounting.totalExcessContribution * sale.contributions[i] / accounting.totalContribution;

                if (accounting.allocation > 0) {
                    /// send allocations to Contributor contracts
                    if (sale.acceptedTokensChains[i] == chainId()) {
                        /// simple transfer on same chain
                        /// @dev use saleID from sale struct to bypass stack too deep
                        SafeERC20.safeTransfer(
                            IERC20(sale.localTokenAddress), 
                            address(uint160(uint256(contributorWallets(sale.saleID, sale.acceptedTokensChains[i])))),
                            accounting.allocation
                        );
                    } else {
                        /// adjust allocation for dust after token bridge transfer
                        accounting.allocation = ICCOStructs.deNormalizeAmount(
                            ICCOStructs.normalizeAmount(accounting.allocation, sale.localTokenDecimals), 
                            sale.localTokenDecimals
                        );

                        /// transfer over wormhole token bridge to foreign Contributor contract
                        SafeERC20.safeApprove(
                            IERC20(sale.localTokenAddress), 
                            address(tknBridge), 
                            accounting.allocation
                        );

                        tknBridge.transferTokens{
                            value : feeAccounting.messageFee
                        }(
                            sale.localTokenAddress,
                            accounting.allocation,
                            sale.acceptedTokensChains[i],
                            contributorWallets(sale.saleID, sale.acceptedTokensChains[i]),
                            0,
                            0
                        );

                        /// uptick fee counter
                        feeAccounting.accumulatedFees += feeAccounting.messageFee;
                    }
                    accounting.totalAllocated += accounting.allocation;
                }

                /// allocation information that is encoded in the SaleSealed struct
                saleSealed.allocations[i] = ICCOStructs.Allocation({
                    tokenIndex : uint8(i),
                    allocation : accounting.allocation,
                    excessContribution : accounting.excessContribution
                });
                unchecked { i += 1; }
            }

            /// @dev transfer dust and partial refund (if applicable) back to refund recipient
            accounting.saleTokenRefund = sale.tokenAmount - accounting.totalAllocated;
            if (accounting.saleTokenRefund > 0) {
                SafeERC20.safeTransfer(
                    IERC20(sale.localTokenAddress),
                    address(uint160(uint256(sale.refundRecipient))),
                    accounting.saleTokenRefund
                );
            } 

            /// @dev send encoded SaleSealed message to Contributor contracts
            wormholeSequence = wormhole.publishMessage{
                value : feeAccounting.messageFee
            }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel()); 

            feeAccounting.accumulatedFees += feeAccounting.messageFee;

            { /// scope to make code more readable
                /// @dev send separate SaleSealed VAA if accepting Solana tokens
                if (sale.solanaAcceptedTokensCount > 0) {
                    /// create new array to handle solana allocations 
                    ICCOStructs.Allocation[] memory solanaAllocations = new ICCOStructs.Allocation[](sale.solanaAcceptedTokensCount);

                    /// remove non-solana allocations in SaleSealed VAA
                    uint8 solanaAllocationIndex;
                    for (uint256 i = 0; i < acceptedTokensLength;) {
                        if (sale.acceptedTokensChains[i] == 1) {
                            solanaAllocations[solanaAllocationIndex] = saleSealed.allocations[i];
                            solanaAllocationIndex += 1;
                        }
                        unchecked { i += 1; }
                    }
                    /// @dev replace allocations in the saleSealed struct with Solana only allocations
                    saleSealed.allocations = solanaAllocations;

                    /// @dev send encoded SaleSealed message to Solana Contributor
                    wormholeSequence2 = wormhole.publishMessage{
                        value : feeAccounting.messageFee
                    }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel());

                    feeAccounting.accumulatedFees += feeAccounting.messageFee;
                }
            }

            /// emit EventSealSale event.
            emit EventSealSale(saleId); 
        } else {
            wormholeSequence = abortSale(saleId, true);
            feeAccounting.accumulatedFees += feeAccounting.messageFee;
        }
        /// @dev refund the caller any extra wormhole fees
        feeAccounting.refundAmount = feeAccounting.valueSent - feeAccounting.accumulatedFees; 
        if (feeAccounting.refundAmount > 0) payable(msg.sender).transfer(feeAccounting.refundAmount);
    }

    /**
     * @dev abortSale serves to mark the sale as aborted.
     * - it sends a SaleAborted VAA
     * - it sends the refundRecipient a refund if the minRaise is not met
     * - it does not send the refund if a prior transfer to the refundRecipient fails 
     * - it emits an EventAbortSale event
     * - it should only be called from within the sealSale function
     */
    function abortSale(
        uint256 saleId,
        bool sendRefund
    ) internal returns (uint256 wormholeSequence) {
        /// set saleAborted
        setSaleAborted(saleId);

        /// cache wormhole instance
        IWormhole wormhole = wormhole();

        /// @dev send encoded SaleAborted message to Contributor contracts
        wormholeSequence = wormhole.publishMessage{
            value : wormhole.messageFee()
        }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
            payloadID : 4,
            saleID : saleId
        })), consistencyLevel());    

        /// @dev refund the sale tokens to refund recipient if sendRefund is true
        if (sendRefund) {
            ConductorStructs.Sale memory sale = sales(saleId);
            SafeERC20.safeTransfer(
                IERC20(sale.localTokenAddress), 
                address(uint160(uint256(sale.refundRecipient))), 
                sale.tokenAmount 
            );
        } 

        /// emit EventAbortSale event.
        emit EventAbortSale(saleId);
    } 

    /**
     * @dev updateSaleAuthority serves to change the KYC authority during a sale
     * - it recovers the signer's public key to validate that the signer is the new authority
     * - it sends an AuthorityUpdated VAA to contributors
     * - it updates the authority in the contract state
     * - it should only be used during an emergency (E.g. authority's key is compromised)
     */
    function updateSaleAuthority(
        uint256 saleId,
        address newAuthority,
        bytes memory sig
    ) public payable onlyOwner returns (uint256 wormholeSequence) {
        require(saleExists(saleId), "37");
        require(newAuthority != address(0) && newAuthority != owner(), "38");

        /// @dev verify new authority signature (proves ownership of keys)
        bytes memory encodedHashData = abi.encodePacked(
            bytes12(0x0),
            address(this),
            saleId
        );
        require(ICCOStructs.verifySignature(encodedHashData, sig, newAuthority), "39");

        /// @dev make sure the sale hasn't been sealed/aborted (don't want to rewrite history)
        ConductorStructs.Sale memory sale = sales(saleId);
        require(!sale.isSealed && !sale.isAborted, "40");

        /// @dev set new authority for the sale and send VAA
        setNewAuthority(saleId, newAuthority);

        /// cache wormhole instance
        IWormhole wormhole = wormhole();
        uint256 messageFee = wormhole.messageFee();

        require(messageFee == msg.value, "41"); 

        /// @dev send encoded AuthorityUpdated message to Contributor contracts
        wormholeSequence = wormhole.publishMessage{
            value : messageFee
        }(0, ICCOStructs.encodeAuthorityUpdated(ICCOStructs.AuthorityUpdated({
            payloadID : 6,
            saleID : saleId,
            newAuthority: newAuthority
        })), consistencyLevel());
    }

    /** 
     * @dev abortBrickedSale serves to abort sales that have not been aborted or sealed
     * within a specified (harcoded value in the contract state) amount of time. A 
     * - it checks that a sale has not been sealed or aborted
     * - it checks that the sale ended greater than 7 days ago
     * - it calls abortSale and sends a SaleAborted VAA
    */
    function abortBrickedSale(uint256 saleId) public payable returns (uint256) {
        require(saleExists(saleId), "42");

        ConductorStructs.Sale memory sale = sales(saleId);
        /** 
         * Make sure the sale hasn't been aborted or sealed already
         * Make sure the sale ended greater than 7 days ago
        */
        require(!sale.isSealed && !sale.isAborted, "43");
        require(block.timestamp > sale.saleEnd + 604800, "44");
        require(msg.value == wormhole().messageFee(), "45");

        return abortSale(saleId, false);
    }

    /// @dev useSaleId serves to update the current saleId in the Conductor state
    function useSaleId() internal returns(uint256 saleId) {
        saleId = getNextSaleId();
        setNextSaleId(saleId + 1);
    }

    /// @dev verifyContributorVM serves to validate VMs by checking against known Contributor contracts    
    function verifyContributorVM(IWormhole.VM memory vm) internal view returns (bool) {
        if (contributorContracts(vm.emitterChainId) == vm.emitterAddress) {
            return true;
        }

        return false;
    }

    /// @dev saleExists serves to check if a sale exists
    function saleExists(uint256 saleId) public view returns (bool exists) {
        exists = (saleId < getNextSaleId());
    }

    // necessary for receiving native assets
    receive() external payable {}
}