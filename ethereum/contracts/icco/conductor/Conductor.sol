// contracts/Conductor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../libraries/external/BytesLib.sol";

import "./ConductorGetters.sol";
import "./ConductorSetters.sol";
import "./ConductorStructs.sol";
import "./ConductorGovernance.sol";

import "../shared/ICCOStructs.sol";

contract Conductor is ConductorGovernance {
    function createSale(
        ICCOStructs.Raise memory raise,
        ICCOStructs.Token[] memory acceptedTokens   
    ) public payable returns (
        uint saleId,
        uint wormholeSequence
    ) {
        // input validation
        require(block.timestamp < raise.saleStart, "sale start must be in the future");
        require(raise.saleStart < raise.saleEnd, "sale end must be after sale start");
        require(raise.tokenAmount > 0, "amount must be > 0");
        require(acceptedTokens.length > 0, "must accept at least one token");
        require(acceptedTokens.length < 255, "too many tokens");
        require(raise.maxRaise > raise.minRaise, "maxRaise must be > minRaise");
         
        { // token deposit context to avoid stack too deep errors

            // query own token balance before transfer
            (,bytes memory queriedBalanceBefore) = raise.token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
            uint256 balanceBefore = abi.decode(queriedBalanceBefore, (uint256));

            // deposit tokens
            SafeERC20.safeTransferFrom(IERC20(raise.token), msg.sender, address(this), raise.tokenAmount);

            // query own token balance after transfer
            (,bytes memory queriedBalanceAfter) = raise.token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
            uint256 balanceAfter = abi.decode(queriedBalanceAfter, (uint256));

            // revert if token has fee
            require(raise.tokenAmount == balanceAfter - balanceBefore, "fee-on-transfer tokens are not supported");

        }
        
        // init sale
        saleId = useSaleId();
        ConductorStructs.Sale memory sale = ConductorStructs.Sale({
            saleID : saleId,
            tokenAddress : bytes32(uint256(uint160(raise.token))),
            tokenChain : chainId(),
            tokenAmount : raise.tokenAmount,
            minRaise: raise.minRaise,
            maxRaise: raise.maxRaise,
            saleStart : raise.saleStart,
            saleEnd : raise.saleEnd,

            acceptedTokensChains : new uint16[](acceptedTokens.length),
            acceptedTokensAddresses : new bytes32[](acceptedTokens.length),
            acceptedTokensConversionRates : new uint128[](acceptedTokens.length),
            contributions : new uint[](acceptedTokens.length),
            contributionsCollected : new bool[](acceptedTokens.length),

            initiator : msg.sender,
            recipient : bytes32(uint256(uint160(raise.recipient))),
            refundRecipient : bytes32(uint256(uint160(raise.refundRecipient))),

            isSealed :  false,
            isAborted : false,

            refundIsClaimed : false
        });

        // populate tokens array
        for(uint i = 0; i < acceptedTokens.length; i++) {
            require(acceptedTokens[i].conversionRate > 0, "conversion rate cannot be zero");
            sale.acceptedTokensChains[i] = acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = acceptedTokens[i].conversionRate;
        }

        // store sale info
        setSale(saleId, sale);

        // attest sale info on wormhole
        ICCOStructs.SaleInit memory saleInit = ICCOStructs.SaleInit({
            // PayloadID uint8 = 1
            payloadID : 1,
            // Sale ID
            saleID : saleId,
            // Address of the token. Left-zero-padded if shorter than 32 bytes
            tokenAddress : bytes32(uint256(uint160(raise.token))),
            // Chain ID of the token
            tokenChain : chainId(),
            // token amount being sold
            tokenAmount : raise.tokenAmount,
            // min raise amount
            minRaise: raise.minRaise,
            // max raise amount
            maxRaise: raise.maxRaise,
            // timestamp raise start
            saleStart : raise.saleStart,
            // timestamp raise end
            saleEnd : raise.saleEnd,
            // accepted Tokens
            acceptedTokens : acceptedTokens,
            // recipient of proceeds
            recipient : bytes32(uint256(uint160(raise.recipient))),
            // refund recipient in case the sale is aborted
            refundRecipient : bytes32(uint256(uint160(raise.refundRecipient)))
        });
        wormholeSequence = wormhole().publishMessage{
            value : msg.value
        }(0, ICCOStructs.encodeSaleInit(saleInit), consistencyLevel()); 
    }

    function abortSaleBeforeStartTime(uint saleId) public payable returns (uint wormholeSequence) {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        require(sale.initiator == msg.sender, "only initiator can abort the sale early");
        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");
        require(block.timestamp < sale.saleStart, "sale cannot be aborted once it has started");

        // set saleAborted
        setSaleAborted(sale.saleID);   

        // attest sale aborted on wormhole
        IWormhole wormhole = wormhole();
        wormholeSequence = wormhole.publishMessage{
            value : msg.value
        }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
            payloadID : 4,
            saleID : saleId
        })), consistencyLevel());
    }

    function collectContribution(bytes memory encodedVm) public {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(verifyContributorVM(vm), "invalid emitter");

        ICCOStructs.ContributionsSealed memory conSealed = ICCOStructs.parseContributionsSealed(vm.payload);

        require(conSealed.chainID == vm.emitterChainId, "contribution from wrong chain id");

        // make sure the sale period has ended
        ConductorStructs.Sale memory sale = sales(conSealed.saleID);

        require(!sale.isAborted, "sale was aborted");
        require(block.timestamp > sale.saleEnd, "sale has not ended yet");

        require(conSealed.contributions.length > 0, "no contributions");
        require(!saleContributionIsCollected(conSealed.saleID, conSealed.contributions[0].tokenIndex), "already collected contribution");

        for(uint i = 0; i < conSealed.contributions.length; i++) {
            setSaleContribution(
                conSealed.saleID,
                conSealed.contributions[i].tokenIndex,
                conSealed.contributions[i].contributed
            );
        }
    } 

    function sealSale(uint saleId) public payable returns (uint wormholeSequence) {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);

        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");
        
        ConductorStructs.InternalAccounting memory accounting;        

        for (uint i = 0; i < sale.contributionsCollected.length; i++) {
            require(saleContributionIsCollected(saleId, i), "missing contribution info");
            accounting.totalContribution += sale.contributions[i] * sale.acceptedTokensConversionRates[i] / 1e18;
        }

        IWormhole wormhole = wormhole();
        if (accounting.totalContribution >= sale.minRaise) {
            ITokenBridge tknBridge = tokenBridge();

            accounting.messageFee = wormhole.messageFee();
            accounting.valueSent = msg.value;

            // this determines refund payments
            // the default value for accounting.excessContribution is zero
            if (accounting.totalContribution > sale.maxRaise) {
                accounting.totalExcessContribution = accounting.totalContribution - sale.maxRaise;
            }

            ICCOStructs.SaleSealed memory saleSealed = ICCOStructs.SaleSealed({
                payloadID : 3,
                saleID : saleId,
                allocations : new ICCOStructs.Allocation[](sale.acceptedTokensAddresses.length)
            });

            // sale succeeded - payout token allocations to contributor contracts
            for(uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
                uint allocation = sale.tokenAmount * (sale.contributions[i] * sale.acceptedTokensConversionRates[i] / 1e18) / accounting.totalContribution;
                uint excessContribution = accounting.totalExcessContribution * sale.contributions[i] / accounting.totalContribution;

                if(allocation > 0) {

                    // send allocations to contributor contracts
                    if (sale.acceptedTokensChains[i] == chainId()) {
                        // simple transfer on same chain
                        SafeERC20.safeTransfer(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(uint160(uint256(contributorContracts(sale.acceptedTokensChains[i])))), allocation);
                    } else {
                        // adjust allocation for dust after token bridge transfer
                        allocation = (allocation / 1e10) * 1e10;

                        // transfer over wormhole token bridge
                        SafeERC20.safeApprove(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(tknBridge), allocation);

                        require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
                        accounting.valueSent -= accounting.messageFee;

                        tknBridge.transferTokens{
                            value : accounting.messageFee
                        }(
                            address(uint160(uint256(sale.tokenAddress))),
                            allocation,
                            sale.acceptedTokensChains[i],
                            contributorContracts(sale.acceptedTokensChains[i]),
                            0,
                            0
                        );
                    }
                    accounting.totalAllocated += allocation;
                }

                saleSealed.allocations[i] = ICCOStructs.Allocation({
                    tokenIndex : uint8(i),
                    allocation : allocation,
                    excessContribution : excessContribution
                });
            }
            // transfer dust back to refund recipient
            accounting.dust = sale.tokenAmount - accounting.totalAllocated;
            if (accounting.dust > 0) {
                SafeERC20.safeTransfer(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(uint160(uint256(sale.refundRecipient))), accounting.dust);
            }

            require(accounting.valueSent >= accounting.messageFee, "insufficient wormhole messaging fees");
            accounting.valueSent -= accounting.messageFee;

            // set saleSealed
            setSaleSealed(saleId);

            // attest sale success on wormhole
            wormholeSequence = wormhole.publishMessage{
                value : accounting.messageFee
            }(0, ICCOStructs.encodeSaleSealed(saleSealed), consistencyLevel());
        } else {
            // set saleAborted
            setSaleAborted(sale.saleID);

            // attest sale aborted on wormhole
            wormholeSequence = wormhole.publishMessage{
                value : msg.value
            }(0, ICCOStructs.encodeSaleAborted(ICCOStructs.SaleAborted({
                payloadID : 4,
                saleID : saleId
            })), consistencyLevel());
        }
    }

    function claimRefund(uint saleId) public {
        require(saleExists(saleId), "sale not initiated");

        ConductorStructs.Sale memory sale = sales(saleId);
        require(sale.isAborted, "token sale is not aborted");
        require(!sale.refundIsClaimed, "already claimed");

        setRefundClaimed(saleId);

        SafeERC20.safeTransfer(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(uint160(uint256(sale.refundRecipient))), sale.tokenAmount);
    }
    
    function useSaleId() internal returns(uint256 saleId) {
        saleId = getNextSaleId();
        setNextSaleId(saleId + 1);
    }

    function verifyContributorVM(IWormhole.VM memory vm) internal view returns (bool){
        if (contributorContracts(vm.emitterChainId) == vm.emitterAddress) {
            return true;
        }

        return false;
    }

    function saleExists(uint saleId) public view returns (bool exists) {
        exists = (saleId < getNextSaleId());
    }
}