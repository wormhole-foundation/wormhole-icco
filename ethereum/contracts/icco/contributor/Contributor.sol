// contracts/Contributor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../../libraries/external/BytesLib.sol";

import "./ContributorGetters.sol";
import "./ContributorSetters.sol";
import "./ContributorStructs.sol";
import "./ContributorGovernance.sol";

import "../shared/ICCOStructs.sol";

/** 
 * @title A cross-chain token sale contributor
 * @notice This contract is in charge of collecting contributions from 
 * individual contributors who wish to participate in a cross-chain 
 * token sale. It acts as a custodian for the contributed funds and 
 * uses the wormhole token bridge to send contributed funds in exchange
 * for the token being sold. It uses the wormhole core messaging layer
 * to disseminate information about the collected contributions to the
 * Conductor contract.
 */ 
contract Contributor is ContributorGovernance, ContributorEvents, ReentrancyGuard {
    using BytesLib for bytes;

    /**
     * @dev initSale serves to initialize a cross-chain token sale, by consuming 
     * information from the Conductor contract regarding the sale.
     * - it validates messages sent via wormhole containing sale information
     * - it saves a copy of the sale in contract storage
     */
    function initSale(bytes memory saleInitVaa) public {
        /// @dev confirms that the message is from the Conductor and valid
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleInitVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        /// parse the sale information sent by the Conductor contract
        ICCOStructs.SaleInit memory saleInit = ICCOStructs.parseSaleInit(vm.payload);
        require(!saleExists(saleInit.saleID), "sale already initiated");

        /// @dev cache to save on gas
        uint256 acceptedTokensLength = saleInit.acceptedTokens.length;

        /// save the parsed sale information 
        ContributorStructs.Sale memory sale = ContributorStructs.Sale({
            saleID : saleInit.saleID,
            tokenAddress : saleInit.tokenAddress,
            tokenChain : saleInit.tokenChain,
            tokenDecimals: saleInit.tokenDecimals,
            saleStart : saleInit.saleStart,
            saleEnd : saleInit.saleEnd,
            unlockTimestamp : saleInit.unlockTimestamp,
            acceptedTokensChains : new uint16[](acceptedTokensLength),
            acceptedTokensAddresses : new bytes32[](acceptedTokensLength),
            acceptedTokensConversionRates : new uint128[](acceptedTokensLength),
            recipient : saleInit.recipient,
            authority : saleInit.authority,
            isSealed : false,
            isAborted : false,
            allocations : new uint256[](acceptedTokensLength),
            excessContributions : new uint256[](acceptedTokensLength)
        });

        /**
         * @dev This saves accepted token info for only the relevant tokens
         * on this Contributor chain.
         * - it checks that the token is a valid ERC20 token
         */  
        for (uint256 i = 0; i < acceptedTokensLength;) {
            if (saleInit.acceptedTokens[i].tokenChain == chainId()) {
                address tokenAddress = address(uint160(uint256(saleInit.acceptedTokens[i].tokenAddress)));
                (, bytes memory queriedTotalSupply) = tokenAddress.staticcall(
                    abi.encodeWithSelector(IERC20.totalSupply.selector)
                );
                require(queriedTotalSupply.length > 0, "non-existent ERC20");
            }
            sale.acceptedTokensChains[i] = saleInit.acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = saleInit.acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = saleInit.acceptedTokens[i].conversionRate;
            unchecked { i += 1; }
        }

        /// save the sale in contract storage
        setSale(saleInit.saleID, sale);

        /// emit EventContribute event.
        emit EventSaleInit(saleInit.saleID);
    }

    /**
     * @dev verifySignature serves to verify a contribution signature for KYC purposes.
     * - it computes the keccak256 hash of data passed by the client
     * - it recovers the KYC authority key from the hashed data and signature
     */ 
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

    /**
     * @dev contribute serves to allow users to contribute funds and
     * participate in the token sale.
     * - it confirms that the wallet is authorized to contribute
     * - it takes custody of contributed funds
     * - it stores information about the contribution and contributor 
     */  
    function contribute(uint256 saleId, uint256 tokenIndex, uint256 amount, bytes memory sig) public nonReentrant { 
        require(saleExists(saleId), "sale not initiated");

        {/// bypass stack too deep
            /// confirm contributions can be accepted at this time
            (, bool isAborted) = getSaleStatus(saleId);

            require(!isAborted, "sale was aborted");

            (uint256 start, uint256 end, ) = getSaleTimeframe(saleId);

            require(block.timestamp >= start, "sale not yet started");
            require(block.timestamp <= end, "sale has ended");
        }

        /// query information for the passed tokendIndex
        (uint16 tokenChain, bytes32 tokenAddressBytes,) = getSaleAcceptedTokenInfo(saleId, tokenIndex);

        require(tokenChain == chainId(), "this token can not be contributed on this chain");   
 
        {///bypass stack too deep
            /// @dev verify authority has signed contribution 
            bytes memory encodedHashData = abi.encodePacked(
                conductorContract(), 
                saleId, 
                tokenIndex, 
                amount, 
                bytes12(0x0),
                msg.sender, 
                getSaleContribution(saleId, tokenIndex, msg.sender)
            ); 
            require(verifySignature(encodedHashData, sig, authority(saleId)), "unauthorized contributor");
        }

        /// query own token balance before transfer
        address tokenAddress = address(uint160(uint256(tokenAddressBytes)));

        (, bytes memory queriedBalanceBefore) = tokenAddress.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, address(this))
        );
        uint256 balanceBefore = abi.decode(queriedBalanceBefore, (uint256));

        /// deposit tokens
        SafeERC20.safeTransferFrom(
            IERC20(tokenAddress), 
            msg.sender, 
            address(this), 
            amount
        );

        /// query own token balance after transfer
        (, bytes memory queriedBalanceAfter) = tokenAddress.staticcall(
            abi.encodeWithSelector(IERC20.balanceOf.selector, address(this))
        );
        uint256 balanceAfter = abi.decode(queriedBalanceAfter, (uint256));

        /// revert if token has fee
        require(amount == balanceAfter - balanceBefore, "fee-on-transfer tokens are not supported");

        /// @dev store contribution information
        setSaleContribution(saleId, msg.sender, tokenIndex, amount);

        /// emit EventContribute event.
        emit EventContribute(saleId, tokenIndex, amount);
    }

    /**
     * @dev attestContributions serves to disseminate contribution information
     * to the Conductor contract once the sale has ended.
     * - it calculates the total contributions for each accepted token
     * - it disseminates a ContributionSealed struct via wormhole
     */ 
    function attestContributions(uint256 saleId) public payable returns (uint256 wormholeSequence) {
        require(saleExists(saleId), "sale not initiated");

        /// confirm that the sale period has ended
        ContributorStructs.Sale memory sale = sales(saleId);

        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");
        require(block.timestamp > sale.saleEnd, "sale has not yet ended");

        /// count accepted tokens for this contract to allocate memory in ContributionsSealed struct 
        uint256 nativeTokens = 0;
        uint16 chainId = chainId(); /// cache from storage
        uint256 acceptedTokensLength = sale.acceptedTokensAddresses.length; /// cache to save on gas
        for (uint256 i = 0; i < acceptedTokensLength;) {
            if (sale.acceptedTokensChains[i] == chainId) {
                nativeTokens++;
            }
            unchecked { i += 1; }
        }

        /// declare ContributionsSealed struct and add contribution info
        ICCOStructs.ContributionsSealed memory consSealed = ICCOStructs.ContributionsSealed({
            payloadID : 2,
            saleID : saleId,
            chainID : uint16(chainId),
            contributions : new ICCOStructs.Contribution[](nativeTokens)
        });

        uint256 ci = 0;
        for (uint256 i = 0; i < acceptedTokensLength;) {
            if (sale.acceptedTokensChains[i] == chainId) {
                consSealed.contributions[ci].tokenIndex = uint8(i);
                consSealed.contributions[ci].contributed = getSaleTotalContribution(saleId, i);
                ci++;
            }
            unchecked { i += 1; }
        }

        /// @dev send encoded ContributionsSealed message to Conductor contract
        wormholeSequence = wormhole().publishMessage{
            value : msg.value
        }(0, ICCOStructs.encodeContributionsSealed(consSealed), consistencyLevel());

        /// emit EventAttestContribution event.
        emit EventAttestContribution(saleId);
    }

    /**
     * @dev saleSealed serves to send contributed funds to the saleRecipient.
     * - it parses the SaleSealed message sent from the Conductor contract
     * - it determines if all the sale tokens are in custody of this contract
     * - it send the contributed funds to the token sale recipient
     */
    function saleSealed(bytes memory saleSealedVaa) public payable {
        /// @dev confirms that the message is from the Conductor and valid
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleSealedVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        /// parses the SaleSealed message sent by the Conductor
        ICCOStructs.SaleSealed memory sealedSale = ICCOStructs.parseSaleSealed(vm.payload); 
        
        ContributorStructs.Sale memory sale = sales(sealedSale.saleID);

        // check to see if the sale was aborted already
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");

        /// confirm that the allocated sale tokens are in custody of this contract
        uint16 thisChainId = chainId(); /// cache from storage
        {
            address saleTokenAddress;
            if (sale.tokenChain == chainId()) {
                /// normal token transfer on same chain
                saleTokenAddress = address(uint160(uint256(sale.tokenAddress)));
            } else {
                /// identify wormhole token bridge wrapper
                saleTokenAddress = tokenBridge().wrappedAsset(sale.tokenChain, sale.tokenAddress);
                require(saleTokenAddress != address(0), "sale token is not attested");
            }

            (, bytes memory queriedTokenBalance) = saleTokenAddress.staticcall(
                abi.encodeWithSelector(IERC20.balanceOf.selector, address(this))
            );
            uint256 tokenBalance = abi.decode(queriedTokenBalance, (uint256));

            require(tokenBalance > 0, "sale token balance must be non-zero");

            /// store the allocated token amounts defined in the SaleSealed message
            uint256 tokenAllocation;
            uint256 allocationsLength = sealedSale.allocations.length;
            for (uint256 i = 0; i < allocationsLength;) {
                ICCOStructs.Allocation memory allo = sealedSale.allocations[i];
                if (sale.acceptedTokensChains[allo.tokenIndex] == thisChainId) {
                    tokenAllocation += allo.allocation;
                    /// set the allocation for this token
                    setSaleAllocation(sealedSale.saleID, allo.tokenIndex, allo.allocation);
                    /// set the excessContribution for this token
                    setExcessContribution(sealedSale.saleID, allo.tokenIndex, allo.excessContribution);
                }
                unchecked { i += 1; }
            }

            require(tokenBalance >= tokenAllocation, "insufficient sale token balance");
            setSaleSealed(sealedSale.saleID);
        }
        
        /** 
         * @dev Initialize token bridge interface in case the contributions
         * are being sent to a recipient on a different chain.
         */
        ITokenBridge tknBridge = tokenBridge();

        ContributorStructs.InternalAccounting memory accounting; 
        accounting.messageFee = wormhole().messageFee();
        accounting.valueSent = msg.value;

        /**
         * @dev Cache the conductorChainId from storage to save on gas.
         * We will check each acceptedToken to see if it's from this chain.
         */ 
        uint16 conductorChainId = conductorChainId();
        uint256 acceptedTokensLength = sale.acceptedTokensAddresses.length;
        for (uint256 i = 0; i < acceptedTokensLength;) {
            if (sale.acceptedTokensChains[i] == thisChainId) {
                /// compute the total contributions to send to the recipient
                uint256 totalContributionsLessExcess = getSaleTotalContribution(sale.saleID, i) - getSaleExcessContribution(sale.saleID, i); 

                /// make sure we have contributions to send to the recipient for this accepted token
                if (totalContributionsLessExcess > 0) {
                    /// convert bytes32 address to evm address
                    address acceptedTokenAddress = address(uint160(uint256(sale.acceptedTokensAddresses[i]))); 

                    /// check to see if this contributor is on the same chain as conductor
                    if (thisChainId == conductorChainId) {
                        /// send contributions to recipient on this chain
                        SafeERC20.safeTransfer(
                            IERC20(acceptedTokenAddress),
                            address(uint160(uint256(sale.recipient))),
                            totalContributionsLessExcess
                        );
                    } else { 
                        /// get token decimals for normalization of token amount
                        uint8 acceptedTokenDecimals;
                        {/// bypass stack too deep
                            (,bytes memory queriedDecimals) = acceptedTokenAddress.staticcall(
                                abi.encodeWithSignature("decimals()")
                            );
                            acceptedTokenDecimals = abi.decode(queriedDecimals, (uint8));
                        }

                        /// perform dust accounting for tokenBridge
                        totalContributionsLessExcess = ICCOStructs.deNormalizeAmount(
                            ICCOStructs.normalizeAmount(
                                totalContributionsLessExcess,
                                acceptedTokenDecimals
                            ),
                            acceptedTokenDecimals
                        );

                        /// transfer over wormhole token bridge
                        SafeERC20.safeApprove(
                            IERC20(acceptedTokenAddress), 
                            address(tknBridge), 
                            totalContributionsLessExcess
                        );

                        require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
                        accounting.valueSent -= accounting.messageFee;

                        tknBridge.transferTokens{
                            value : accounting.messageFee
                        }(
                            acceptedTokenAddress,
                            totalContributionsLessExcess,
                            conductorChainId,
                            sale.recipient,
                            0,
                            0
                        );
                    }
                }
            }
            unchecked { i += 1; }
        } 

        /// emit EventSealSale event.
        emit EventSaleSealed(sale.saleID);
    }

    /// @dev saleAborted serves to mark the sale unnsuccessful or canceled 
    function saleAborted(bytes memory saleAbortedVaa) public {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleAbortedVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        ICCOStructs.SaleAborted memory abortedSale = ICCOStructs.parseSaleAborted(vm.payload);

        /// set the sale aborted
        setSaleAborted(abortedSale.saleID);
    }

    /**
     * @dev claimAllocation serves to send contributors a preallocated amount of sale tokens.
     * - it confirms that the sale was sealed
     * - it transfers sale tokens to the contributor's wallet
     * - it marks the allocation as claimed to prevent multiple claims for the same allocation
     * - it only distributes tokens once the unlock period has ended
     */
    function claimAllocation(uint256 saleId, uint256 tokenIndex) public {
        require(saleExists(saleId), "sale not initiated");

        /// make sure the sale is sealed and not aborted
        (bool isSealed, bool isAborted) = getSaleStatus(saleId);
        (, , uint256 unlockTimestamp) = getSaleTimeframe(saleId);

        require(!isAborted, "token sale is aborted");
        require(isSealed, "token sale is not yet sealed");
        require(!allocationIsClaimed(saleId, tokenIndex, msg.sender), "allocation already claimed"); 

        /// @dev contributors can only claim after the unlock timestamp
        require(block.timestamp >= unlockTimestamp, "tokens have not been unlocked");

        /// make sure the contributor is claiming on the right chain
        (uint16 contributedTokenChainId, , ) = getSaleAcceptedTokenInfo(saleId, tokenIndex);

        require(contributedTokenChainId == chainId(), "allocation needs to be claimed on a different chain");

        /// set the allocation claimed - also serves as reentrancy protection
        setAllocationClaimed(saleId, tokenIndex, msg.sender);

        ContributorStructs.Sale memory sale = sales(saleId); 

        /**
         * @dev Cache contribution variables since they're used to calculate
         * the allocation and excess contribution.
         */
        uint256 thisContribution = getSaleContribution(saleId, tokenIndex, msg.sender);
        uint256 totalContribution = getSaleTotalContribution(saleId, tokenIndex);

        /// calculate the allocation and send to the contributor
        uint256 thisAllocation = (getSaleAllocation(saleId, tokenIndex) * thisContribution) / totalContribution;

        address tokenAddress;
        if (sale.tokenChain == chainId()) {
            /// normal token transfer on same chain
            tokenAddress = address(uint160(uint256(sale.tokenAddress)));
        } else {
            /// identify wormhole token bridge wrapper
            tokenAddress = tokenBridge().wrappedAsset(sale.tokenChain, sale.tokenAddress);
        }
        SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, thisAllocation); 

        /// emit EventClaimAllocation event.
        emit EventClaimAllocation(saleId, tokenIndex, thisAllocation);
    }

    /**
     * @dev claimExcessContribution serves to send contributors a refund for any excessContributions.
     * - it confirms that the sale was sealed
     * - it calculates the excessContribution owed to the contributor
     * - it marks the excessContribution as claimed to prevent multiple claims for the same refund
     * - it transfers the excessContribution to the contributor's wallet
     */
    function claimExcessContribution(uint256 saleId, uint256 tokenIndex) public {
        require(saleExists(saleId), "sale not initiated");

        /// return any excess contributions 
        uint256 excessContribution = getSaleExcessContribution(saleId, tokenIndex);

        require(excessContribution > 0, "no excess contributions for this token");

        (bool isSealed, ) = getSaleStatus(saleId);

        require(isSealed, "token sale is not sealed");
        require(!excessContributionIsClaimed(saleId, tokenIndex, msg.sender), "excess contribution already claimed");

        setExcessContributionClaimed(saleId, tokenIndex, msg.sender);

        /// calculate how much excess to refund
        uint256 thisExcessContribution = (excessContribution * getSaleContribution(saleId, tokenIndex, msg.sender)) / getSaleTotalContribution(saleId, tokenIndex);

        /// grab the contributed token address  
        (, bytes32 tokenAddressBytes, ) = getSaleAcceptedTokenInfo(saleId, tokenIndex);
        SafeERC20.safeTransfer(
            IERC20(address(uint160(uint256(tokenAddressBytes)))), 
            msg.sender, 
            thisExcessContribution
        );

        /// emit EventClaimExcessContribution event.
        emit EventClaimExcessContribution(saleId, tokenIndex, thisExcessContribution);
    }

    /**
     * @dev claimRefund serves to refund the contributor when a sale is unsuccessful. 
     * - it confirms that the sale was aborted
     * - it transfers the contributed funds back to the contributor's wallet
     */
    function claimRefund(uint256 saleId, uint256 tokenIndex) public {
        require(saleExists(saleId), "sale not initiated");

        (, bool isAborted) = getSaleStatus(saleId);

        require(isAborted, "token sale is not aborted");
        require(!refundIsClaimed(saleId, tokenIndex, msg.sender), "refund already claimed");

        setRefundClaimed(saleId, tokenIndex, msg.sender);

        (uint16 tokenChainId, bytes32 tokenAddressBytes, ) = getSaleAcceptedTokenInfo(saleId, tokenIndex);
        require(tokenChainId == chainId(), "refund needs to be claimed on another chain");

        address tokenAddress = address(uint160(uint256(tokenAddressBytes)));

        /// grab the amount to refund the user
        uint256 thisRefundContribution = getSaleContribution(saleId, tokenIndex, msg.sender);

        /// refund tokens
        SafeERC20.safeTransfer(
            IERC20(tokenAddress), 
            msg.sender, 
            thisRefundContribution
        );

        /// emit EventClaimRefund event.
        emit EventClaimRefund(saleId, tokenIndex, thisRefundContribution);
    }

    // @dev verifyConductorVM serves to validate VMs by checking against the known Conductor contract 
    function verifyConductorVM(IWormhole.VM memory vm) internal view returns (bool) {
        if (conductorContract() == vm.emitterAddress && conductorChainId() == vm.emitterChainId) {
            return true;
        }

        return false;
    }

    /// @dev saleExists serves to check if a sale exists
    function saleExists(uint256 saleId) public view returns (bool exists) {
        exists = (getSaleTokenAddress(saleId) != bytes32(0));
    }
}