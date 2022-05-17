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
 * send the sale token to contributor contracts in exchange for contributed funds. 
 * For unsuccessful sales, this contract will return the sale tokens to a 
 * specified recipient address.
 */ 
contract Conductor is ConductorGovernance, ReentrancyGuard {
    /**
     * @dev createSale serves to initialize a cross-chain token sale and disseminate 
     * information about the sale to registered Contributor contracts.
     * - it validates sale parameters passed in by the client
     * - it saves a copy of the sale in contract storage
     * - it encodes and disseminates sale information to contributor contracts via wormhole
     */
    function createSale(
        ICCOStructs.Raise memory raise,
        ICCOStructs.Token[] memory acceptedTokens   
    ) public payable nonReentrant returns (
        uint saleId,
        uint wormholeSequence
    ) {
        /// validate sale parameters from client
        require(block.timestamp < raise.saleStart, "sale start must be in the future");
        require(raise.saleStart < raise.saleEnd, "sale end must be after sale start");
        /// set timestamp cap for non-evm contributor contracts
        require(raise.saleStart <= 2**63-1, "saleStart too far in the future");
        require(raise.tokenAmount > 0, "amount must be > 0");
        require(acceptedTokens.length > 0, "must accept at least one token");
        require(acceptedTokens.length < 255, "too many tokens");
        require(raise.maxRaise > raise.minRaise, "maxRaise must be > minRaise");

        /// grab the local token address (address of sale token on conductor chain)
        address localTokenAddress;
        if (raise.tokenChain == chainId()) {
            localTokenAddress = address(uint160(uint256(raise.token)));
        } else {
            /// identify wormhole token bridge wrapper
            localTokenAddress = tokenBridge().wrappedAsset(raise.tokenChain, raise.token);  
            require(localTokenAddress != address(0), "wrapped address not found on this chain"); 
        }

        uint8 localTokenDecimals;  
        { /// avoid stack too deep errors
            /** 
             * @dev Fetch the sale token decimals and place in the saleInit struct.
             * The contributors need to know this to scale allocations on non-evm chains.            
             */
            (,bytes memory queriedDecimals) = localTokenAddress.staticcall(
                abi.encodeWithSignature("decimals()")
            );
            localTokenDecimals = abi.decode(queriedDecimals, (uint8));

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
        }
        
        /// create sale struct for Conductor's view of the sale
        saleId = useSaleId();
        ConductorStructs.Sale memory sale = ConductorStructs.Sale({
            saleID : saleId,
            /// client sale parameters
            tokenAddress : raise.token,
            tokenChain : raise.tokenChain,
            localTokenDecimals: localTokenDecimals,
            localTokenAddress: localTokenAddress,     
            tokenAmount : raise.tokenAmount,
            minRaise: raise.minRaise,
            maxRaise: raise.maxRaise,
            saleStart : raise.saleStart,
            saleEnd : raise.saleEnd,
            /// save accepted token info
            acceptedTokensChains : new uint16[](acceptedTokens.length),
            acceptedTokensAddresses : new bytes32[](acceptedTokens.length),
            acceptedTokensConversionRates : new uint128[](acceptedTokens.length),
            contributions : new uint[](acceptedTokens.length),
            contributionsCollected : new bool[](acceptedTokens.length),
            /// sale wallet management 
            initiator : msg.sender, 
            recipient : bytes32(uint256(uint160(raise.recipient))),
            refundRecipient : bytes32(uint256(uint160(raise.refundRecipient))),
            /// sale identifiers
            isSealed :  false,
            isAborted : false,
            refundIsClaimed : false
        });

        /// populate the accpeted token arrays
        for(uint i = 0; i < acceptedTokens.length; i++) {
            require(acceptedTokens[i].conversionRate > 0, "conversion rate cannot be zero");
            sale.acceptedTokensChains[i] = acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = acceptedTokens[i].conversionRate;
        }

        /// store sale info
        setSale(saleId, sale);

        /// create sale struct to disseminate to contributors
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
            /// token amount being sold
            tokenAmount : raise.tokenAmount,
            /// min raise amount
            minRaise: raise.minRaise,
            /// max raise amount
            maxRaise: raise.maxRaise,
            /// timestamp raise start
            saleStart : raise.saleStart,
            /// timestamp raise end
            saleEnd : raise.saleEnd,
            /// accepted Tokens
            acceptedTokens : acceptedTokens,
            /// recipient of proceeds
            recipient : bytes32(uint256(uint160(raise.recipient))),
            /// refund recipient in case the sale is aborted
            refundRecipient : bytes32(uint256(uint160(raise.refundRecipient)))
        });

        /**
         * @dev send encoded saleInit struct to contributors via wormhole.
         * The msg.value is the fee collected by wormhole for messages.
         */
        wormholeSequence = wormhole().publishMessage{
            value : msg.value
        }(0, ICCOStructs.encodeSaleInit(saleInit), consistencyLevel());
    }

    /**
     * @dev abortSaleBeforeStartTime serves to allow the sale initiator to 
     * cancel the sale before the saleStart time.
     * - it confirms that the sale has not started
     * - it only allows the sale initiator to invoke the method
     * - it encodes and disseminates a saleAborted message to the Contributor contracts
     */    
    function abortSaleBeforeStartTime(uint saleId) public payable returns (uint wormholeSequence) {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// confirm that caller is the sale initiator
        require(sale.initiator == msg.sender, "only initiator can abort the sale early");

        /// make sure that the sale is still valid and hasn't started yet
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");
        require(block.timestamp < sale.saleStart, "sale cannot be aborted once it has started");

        /// set saleAborted
        setSaleAborted(sale.saleID);   

        /// @dev send encoded saleAborted struct to Contributor contracts
        IWormhole wormhole = wormhole();
        wormholeSequence = wormhole.publishMessage{
            value : msg.value
        }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
            payloadID : 4,
            saleID : saleId
        })), consistencyLevel());
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

        /// parse the contributionsSealed struct emitted by a Contributor contract
        ICCOStructs.ContributionsSealed memory conSealed = ICCOStructs.parseContributionsSealed(vm.payload);

        require(conSealed.chainID == vm.emitterChainId, "contribution from wrong chain id");

        /// make sure the sale has ended before accepting contribution information
        ConductorStructs.Sale memory sale = sales(conSealed.saleID);

        require(!sale.isAborted, "sale was aborted");
        require(block.timestamp > sale.saleEnd, "sale has not ended yet");

        /// confirm that contribution information is valid and that it hasn't been collected for this Contributor
        require(conSealed.contributions.length > 0, "no contributions");
        require(!saleContributionIsCollected(
            conSealed.saleID, conSealed.contributions[0].tokenIndex), 
            "already collected contribution"
        );

        /// save the total contribution amount for each accepted token 
        for(uint i = 0; i < conSealed.contributions.length; i++) {
            setSaleContribution(
                conSealed.saleID,
                conSealed.contributions[i].tokenIndex,
                conSealed.contributions[i].contributed
            );
        }
    } 

    /**
     * @dev sealSale serves to determine if a sale was successful or not. 
     * - it calculates the total amount raised in the sale
     * - it determines if the sale was a success by comparing the total to minRaise
     * - it calculates allocations and excess contributions for each accepted token
     * - it disseminates a saleSealed or saleAborted message to Contributors via wormhole
     */
    function sealSale(uint saleId) public payable returns (uint wormholeSequence) {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        /// make sure the sale hasn't been aborted or sealed already
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");

        ConductorStructs.InternalAccounting memory accounting;        

        for (uint i = 0; i < sale.contributionsCollected.length; i++) {
            require(saleContributionIsCollected(saleId, i), "missing contribution info");
            /**
             * @dev This calculates the total contribution for each accepted token.
             * - it uses the conversion rate to convert contributions into the minRaise denomination
             */
            accounting.totalContribution += sale.contributions[i] * sale.acceptedTokensConversionRates[i] / 1e18;
        }

        IWormhole wormhole = wormhole();

        /// check to see if the sale was successful
        if (accounting.totalContribution >= sale.minRaise) {
            ITokenBridge tknBridge = tokenBridge();

            /// set the messageFee and valueSent values 
            accounting.messageFee = wormhole.messageFee();
            accounting.valueSent = msg.value;

            /**
             * @dev This determines if contributors qualify for refund payments.
             * - the default value for accounting.excessContribution is zero
             * - the difference between maxRaise and totalContribution is the total
             * reward due to contributors. 
             */
            if (accounting.totalContribution > sale.maxRaise) {
                accounting.totalExcessContribution = accounting.totalContribution - sale.maxRaise;
            }

            /// @dev This is a successful sale struct that saves sale token allocation information.
            ICCOStructs.SaleSealed memory saleSealed = ICCOStructs.SaleSealed({
                payloadID : 3,
                saleID : saleId,
                allocations : new ICCOStructs.Allocation[](sale.acceptedTokensAddresses.length)
            });

            /// calculate allocations and excessContributions for each accepted token 
            for(uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
                uint allocation = sale.tokenAmount * (sale.contributions[i] * sale.acceptedTokensConversionRates[i] / 1e18) / accounting.totalContribution;
                uint excessContribution = accounting.totalExcessContribution * sale.contributions[i] / accounting.totalContribution;

                if (allocation > 0) {
                    /// send allocations to Contributor contracts
                    if (sale.acceptedTokensChains[i] == chainId()) {
                        /// simple transfer on same chain
                        SafeERC20.safeTransfer(
                            IERC20(sale.localTokenAddress), 
                            address(uint160(uint256(contributorCustody(sale.acceptedTokensChains[i])))),
                            allocation
                        );
                    } else {
                        /// adjust allocation for dust after token bridge transfer
                        allocation = ICCOStructs.deNormalizeAmount(
                            ICCOStructs.normalizeAmount(allocation, sale.localTokenDecimals), 
                            sale.localTokenDecimals
                        );

                        /// transfer over wormhole token bridge to foreign Contributor contract
                        SafeERC20.safeApprove(
                            IERC20(sale.localTokenAddress), 
                            address(tknBridge), 
                            allocation
                        );

                        require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
                        accounting.valueSent -= accounting.messageFee;

                        tknBridge.transferTokens{
                            value : accounting.messageFee
                        }(
                            sale.localTokenAddress,
                            allocation,
                            sale.acceptedTokensChains[i],
                            contributorCustody(sale.acceptedTokensChains[i]),
                            0,
                            0
                        );
                    }
                    accounting.totalAllocated += allocation;
                }

                /// allocation information that is encoded in the saleSealed struct
                saleSealed.allocations[i] = ICCOStructs.Allocation({
                    tokenIndex : uint8(i),
                    allocation : allocation,
                    excessContribution : excessContribution
                });
            }

            /// transfer dust back to refund recipient
            accounting.dust = sale.tokenAmount - accounting.totalAllocated;
            if (accounting.dust > 0) {
                SafeERC20.safeTransfer(
                    IERC20(sale.localTokenAddress), 
                    address(uint160(uint256(sale.refundRecipient))), 
                    accounting.dust
                );
            }

            require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
            accounting.valueSent -= accounting.messageFee;

            /// set saleSealed
            setSaleSealed(saleId);

            /// @dev send encoded saleSealed message to Contributor contracts
            wormholeSequence = wormhole.publishMessage{
                value : accounting.messageFee
            }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel());
        } else {
            /// set saleAborted
            setSaleAborted(sale.saleID);

            /// @dev send encoded saleAborted message to Contributor contracts
            wormholeSequence = wormhole.publishMessage{
                value : msg.value
            }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
                payloadID : 4,
                saleID : saleId
            })), consistencyLevel());
        }
    }

    /**
     * @dev claimRefund serves to refund the refundRecipient when a sale is unsuccessful. 
     * - it confirms that the sale was aborted
     * - it transfers the sale tokens to the refundRecipient
     */
    function claimRefund(uint saleId) public {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);
        require(sale.isAborted, "token sale is not aborted");
        require(!sale.refundIsClaimed, "already claimed");

        /// set the refund claimed 
        setRefundClaimed(saleId);

        /// simple token transfer to refundRecipient
        SafeERC20.safeTransfer(
            IERC20(sale.localTokenAddress), 
            address(uint160(uint256(sale.refundRecipient))), 
            sale.tokenAmount
        );
    }
 
    /// @dev useSaleId serves to update the current saleId in the Conductor state
    function useSaleId() internal returns(uint256 saleId) {
        saleId = getNextSaleId();
        setNextSaleId(saleId + 1);
    }

    /// @dev verifyContributorVM serves to validate VMs by checking against known Contributor contracts    
    function verifyContributorVM(IWormhole.VM memory vm) internal view returns (bool){
        if (contributorContracts(vm.emitterChainId) == vm.emitterAddress) {
            return true;
        }

        return false;
    }

    /// @dev saleExists serves to check if a sale exists
    function saleExists(uint saleId) public view returns (bool exists) {
        exists = (saleId < getNextSaleId());
    }
}