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
    /// @dev create dynamic storage for accepted solana tokens
    ICCOStructs.SolanaToken[] solanaAcceptedTokens;

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
            require(localTokenAddress != address(0), "wrapped address not found on this chain"); 
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
        require(raise.tokenAmount == balanceAfter - balanceBefore, "fee-on-transfer tokens are not supported");

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
        require(block.timestamp < raise.saleStart, "sale start must be in the future");
        require(raise.saleStart < raise.saleEnd, "sale end must be after sale start");
        require(raise.unlockTimestamp >= raise.saleEnd, "unlock timestamp should be >= saleEnd");
        require(raise.unlockTimestamp - raise.saleEnd <= 63072000, "unlock timestamp must be <= 2 years in the future");
        /// set timestamp cap for non-evm Contributor contracts
        require(raise.saleStart <= 2**63-1, "saleStart too far in the future");
        require(raise.tokenAmount > 0, "amount must be > 0");
        require(acceptedTokens.length > 0, "must accept at least one token");
        require(acceptedTokens.length < 255, "too many tokens");
        require(raise.minRaise > 0, "minRaise must be > 0");
        require(raise.maxRaise >= raise.minRaise, "maxRaise must be >= minRaise");
        /// Sanity check address
        require(raise.token != bytes32(0), "token must not be bytes32(0)");
        require(raise.solanaTokenAccount != bytes32(0), "solanaTokenAccount must not be bytes32(0)");
        require(raise.recipient != address(0), "recipient must not be address(0)");
        require(raise.refundRecipient != address(0), "refundRecipient must not be address(0)");

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
            solanaTokenAccount: raise.solanaTokenAccount,
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
                    "duplicate tokens not allowed"
                );
                unchecked { j += 1; }
            }

            /// @dev sanity check accepted tokens
            require(acceptedTokens[i].conversionRate > 0, "conversion rate cannot be zero");
            require(acceptedTokens[i].tokenAddress != bytes32(0), "acceptedTokens.tokenAddress must not be bytes32(0)");

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
                require(solanaAcceptedTokens.length < 8, "too many solana tokens");
                /// save in contract storage
                solanaAcceptedTokens.push(solanaToken);
            }
            unchecked { i += 1; }
        }

        /// save number of accepted solana tokens in the sale
        sale.solanaAcceptedTokensCount = uint8(solanaAcceptedTokens.length);

        /// store sale info
        setSale(saleId, sale);

        /// cache wormhole instance
        IWormhole wormhole = wormhole();
        uint256 messageFee = wormhole.messageFee();

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
            value : messageFee
        }(0, ICCOStructs.encodeSaleInit(saleInit), consistencyLevel());

        /// see if the sale accepts any Solana tokens
        if (sale.solanaAcceptedTokensCount > 0) {
            /// create SolanaSaleInit struct to disseminate to the Solana Contributor
            ICCOStructs.SolanaSaleInit memory solanaSaleInit = ICCOStructs.SolanaSaleInit({
                payloadID : 5,
                /// sale ID
                saleID : saleId,
                /// sale token ATA for solana 
                solanaTokenAccount: raise.solanaTokenAccount,
                /// chain ID of the token
                tokenChain : raise.tokenChain,
                /// token decimals
                tokenDecimals: localTokenDecimals,
                /// timestamp raise start
                saleStart : raise.saleStart,
                /// timestamp raise end
                saleEnd : raise.saleEnd,
                /// accepted Tokens
                acceptedTokens : solanaAcceptedTokens,
                /// recipient of proceeds
                recipient : bytes32(uint256(uint160(raise.recipient))),
                /// public key of kyc authority 
                authority: raise.authority,
                /// unlock timestamp (when tokens can be claimed)
                unlockTimestamp : raise.unlockTimestamp
            });

            /// @dev send encoded SolanaSaleInit struct to the solana Contributor
            wormholeSequence2 = wormhole.publishMessage{
                value : messageFee
            }(0, ICCOStructs.encodeSolanaSaleInit(solanaSaleInit), consistencyLevel());    

            /// @dev garbage collection to save on gas fees
            delete solanaAcceptedTokens;
        }

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
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// confirm that caller is the sale initiator
        require(sale.initiator == msg.sender, "only initiator can abort the sale early");

        /// make sure that the sale is still valid and hasn't started yet
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");
        require(block.timestamp < sale.saleStart, "sale cannot be aborted once it has started");

        /// set saleAborted
        setSaleAborted(sale.saleID);   

        /// @dev send encoded SaleAborted struct to Contributor contracts
        IWormhole wormhole = wormhole();
        wormholeSequence = wormhole.publishMessage{
            value : msg.value
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
     */ 
    function collectContribution(bytes memory encodedVm) public {
        /// validate encodedVm and emitter
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(verifyContributorVM(vm), "invalid emitter");

        /// parse the ContributionsSealed struct emitted by a Contributor contract
        ICCOStructs.ContributionsSealed memory conSealed = ICCOStructs.parseContributionsSealed(vm.payload);

        require(conSealed.chainID == vm.emitterChainId, "contribution from wrong chain id");

        /// make sure the sale has ended before accepting contribution information
        ConductorStructs.Sale memory sale = sales(conSealed.saleID);

        require(!sale.isAborted, "sale was aborted");
        require(block.timestamp > sale.saleEnd, "sale has not ended yet");

        /// cache because it's referenced several times
        uint256 contributionsLength = conSealed.contributions.length; 

        // confirm that contribution information is valid and that it hasn't been collected for this Contributor
        require(contributionsLength > 0, "no contributions");
        require(!saleContributionIsCollected(
            conSealed.saleID, conSealed.contributions[0].tokenIndex), 
            "already collected contribution"
        );

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
    function sealSale(uint256 saleId) public payable returns (uint256 wormholeSequence, uint256 wormholeSequence2) {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// make sure the sale hasn't been aborted or sealed already
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");

        ConductorStructs.InternalAccounting memory accounting;        

        uint256 contributionsLength = sale.contributionsCollected.length;
        for (uint256 i = 0; i < contributionsLength;) {
            require(saleContributionIsCollected(saleId, i), "missing contribution info");
            /**
            * @dev This calculates the total contribution for each accepted token.
            * - it uses the conversion rate to convert contributions into the minRaise denomination
            */
            accounting.totalContribution += sale.contributions[i] * sale.acceptedTokensConversionRates[i]; 
            unchecked { i += 1; }
        }
        accounting.totalContribution /= 1e18;
        
        IWormhole wormhole = wormhole();

        /// check to see if the sale was successful
        if (accounting.totalContribution >= sale.minRaise) {
            /// set saleSealed
            setSaleSealed(saleId);

            ITokenBridge tknBridge = tokenBridge();

            /// set the messageFee and valueSent values 
            accounting.messageFee = wormhole.messageFee();
            accounting.valueSent = msg.value;   

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

            /// cache because it's referenced several times
            uint256 acceptedTokensLength = sale.acceptedTokensAddresses.length;

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

                        require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
                        accounting.valueSent -= accounting.messageFee;

                        tknBridge.transferTokens{
                            value : accounting.messageFee
                        }(
                            sale.localTokenAddress,
                            accounting.allocation,
                            sale.acceptedTokensChains[i],
                            contributorWallets(sale.saleID, sale.acceptedTokensChains[i]),
                            0,
                            0
                        );
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

            /// @dev transfer dust partial refund (if applicable) back to refund recipient
            accounting.saleTokenRefund = sale.tokenAmount - accounting.totalAllocated;

            if (accounting.saleTokenRefund > 0) {
                /// @dev using low-level call instead of safeTransfer to fetch success boolean
                (bool success, ) = sale.localTokenAddress.call(
                    abi.encodeWithSelector(
                        IERC20(sale.localTokenAddress).transfer.selector,
                        address(uint160(uint256(sale.refundRecipient))), 
                        accounting.saleTokenRefund
                    )
                );

                /**
                 * @dev If the success boolean value is false, someone is attempting a reentrancy attack
                 * - the contract will emit a saleAborted VAA so contributor contracts will allow
                 * contributors to claim a refund
                 * regardless of the sale outcome, the sale will be aborted
                 */
                if (!success) {
                    wormholeSequence = abortSale(saleId, false);
                    return (wormholeSequence, 0);
                } 
            } 

            require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
            accounting.valueSent -= accounting.messageFee; 

            /// @dev send encoded SaleSealed message to Contributor contracts
            wormholeSequence = wormhole.publishMessage{
                value : accounting.messageFee
            }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel()); 

            { /// scope to make code more readable
                /// @dev send separate SaleSealed VAA if accepting Solana tokens
                if (sale.solanaAcceptedTokensCount > 0) {
                    // make sure we still have enough gas to send the Solana message  
                    require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");

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
                        value : accounting.messageFee
                    }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel());
                }
            }

            /// emit EventSealSale event.
            emit EventSealSale(saleId); 
        } else {
            wormholeSequence = abortSale(saleId, true);
            return (wormholeSequence, 0);
        }
    }

    /**
     * @dev abortSale serves to mark the sale as aborted.
     * - it sends a SaleAborted VAA
     * - it sends the refundRecipient a refund if the minRaise is not met
     * - it does not send the refund if a prior transfer to the refundRecipient fails 
     * - it emits an EventAbortSale event
     * - it should only be called from within the sealSale function
     */
    function abortSale(uint256 saleId, bool sendRefund) internal returns (uint256 wormholeSequence) {
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
}