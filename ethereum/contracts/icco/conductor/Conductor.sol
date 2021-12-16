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

contract Conductor is ConductorGovernance, ICCOStructs {
    function createSale(
        address token,
        uint tokenAmount,
        uint minRaise,
        uint saleStart,
        uint saleEnd,
        Token[] memory acceptedTokens,
        address recipient,
        address refundRecipient
    ) public payable returns (
        uint saleId,
        uint wormholeSequence
    ) {
        // input validation
        require(block.timestamp < saleStart, "sale start must be in the future");
        require(saleStart < saleEnd, "sale end must be after sale start");
        require(tokenAmount > 0, "amount must be > 0");
        require(acceptedTokens.length > 0, "must accept at least one token");
        require(acceptedTokens.length < 255, "too many tokens");

        { // token deposit context to avoid stack too deep errors

            // query own token balance before transfer
            (,bytes memory queriedBalanceBefore) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
            uint256 balanceBefore = abi.decode(queriedBalanceBefore, (uint256));

            // deposit tokens
            SafeERC20.safeTransferFrom(IERC20(token), msg.sender, address(this), tokenAmount);

            // query own token balance after transfer
            (,bytes memory queriedBalanceAfter) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
            uint256 balanceAfter = abi.decode(queriedBalanceAfter, (uint256));

            // revert if token has fee
            require(tokenAmount == balanceAfter - balanceBefore, "fee-on-transfer tokens are not supported");

        }

        // init sale
        saleId = useSaleId();
        ConductorStructs.Sale memory sale = ConductorStructs.Sale({
            saleID : saleId,
            tokenAddress : bytes32(uint256(uint160(token))),
            tokenChain : chainId(),
            tokenAmount : tokenAmount,
            minRaise: minRaise,
            saleStart : saleStart,
            saleEnd : saleEnd,

            acceptedTokensChains : new uint16[](acceptedTokens.length),
            acceptedTokensAddresses : new bytes32[](acceptedTokens.length),
            acceptedTokensConversionRates : new uint256[](acceptedTokens.length),
            contributions : new uint[](acceptedTokens.length),
            contributionsCollected : new bool[](acceptedTokens.length),

            recipient : bytes32(uint256(uint160(recipient))),
            refundRecipient : bytes32(uint256(uint160(refundRecipient))),

            isSealed :  false,
            isAborted : false,

            refundIsClaimed : false
        });
        // populate tokens array
        for(uint i = 0; i < acceptedTokens.length; i++) {
            sale.acceptedTokensChains[i] = acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = acceptedTokens[i].conversionRate;
        }

        // store sale info
        setSale(saleId, sale);

        // attest sale info on wormhole
        SaleInit memory saleInit = SaleInit({
            // PayloadID uint8 = 1
            payloadID : 1,
            // Sale ID
            saleID : saleId,
            // Address of the token. Left-zero-padded if shorter than 32 bytes
            tokenAddress : bytes32(uint256(uint160(token))),
            // Chain ID of the token
            tokenChain : chainId(),
            // token amount being sold
            tokenAmount : tokenAmount,
            // min raise amount
            minRaise: minRaise,
            // timestamp raise start
            saleStart : saleStart,
            // timestamp raise end
            saleEnd : saleEnd,
            // accepted Tokens
            acceptedTokens : acceptedTokens,
            // recipient of proceeds
            recipient : bytes32(uint256(uint160(recipient))),
            // refund recipient in case the sale is aborted
            refundRecipient : bytes32(uint256(uint160(refundRecipient)))
        });
        wormholeSequence = wormhole().publishMessage{
            value : msg.value
        }(0, encodeSaleInit(saleInit), 15);
    }

    function collectContribution(bytes memory encodedVm) public {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(verifyContributorVM(vm), "invalid emitter");

        ContributionsSealed memory conSealed = parseContributionsSealed(vm.payload);

        require(conSealed.chainID == vm.emitterChainId, "contribution from wrong chain id");

        for(uint i = 0; i < conSealed.contributions.length; i++) {
            setSaleContribution(
                conSealed.saleID,
                conSealed.contributions[i].tokenIndex,
                conSealed.contributions[i].contributed
            );
        }
    }

    function sealSale(uint saleId) public payable returns (uint wormholeSequence) {
        ConductorStructs.Sale memory sale = sales(saleId);

        require(!sale.isSealed && !sale.isAborted, "already sealed / aborted");

        uint totalContribution;
        for (uint i = 0; i < sale.contributionsCollected.length; i++) {
            require(sale.contributionsCollected[i], "missing contribution info");
            totalContribution += sale.contributions[i] * 1e18 / sale.acceptedTokensConversionRates[i];
        }

        SaleSealed memory saleSealed = SaleSealed({
            payloadID : 3,
            saleID : saleId,
            allocations : new Allocation[](sale.acceptedTokensAddresses.length)
        });

        IWormhole wormhole = wormhole();
        if (totalContribution >= sale.minRaise) {
            BridgeImplementation tknBridge = tokenBridge();

            uint messageFee = wormhole.messageFee();
            uint valueSent = msg.value;

            // sale succeeded - payout token allocations to contributor contracts
            for(uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
                uint allocation = sale.tokenAmount * (sale.contributions[i] * 1e18 / sale.acceptedTokensConversionRates[i]) / totalContribution;

                saleSealed.allocations[i] = Allocation({
                    tokenIndex : uint8(i),
                    allocation : allocation
                });

                if(allocation > 0) {
                    // send allocations to contributor contracts
                    if (sale.acceptedTokensChains[i] == chainId()) {
                        // simple transfer on same chain
                        SafeERC20.safeTransfer(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(uint160(uint256(contributorContracts(sale.acceptedTokensChains[i])))), allocation);
                    } else {
                        // transfer over wormhole token bridge
                        SafeERC20.safeApprove(IERC20(address(uint160(uint256(sale.tokenAddress)))), address(tknBridge), allocation);

                        require(valueSent >= messageFee, "insufficient wormhole messaging fees");
                        valueSent -= messageFee;

                        tknBridge.transferTokens{
                            value : messageFee
                        }(
                            address(uint160(uint256(sale.tokenAddress))),
                            allocation,
                            sale.acceptedTokensChains[i],
                            contributorContracts(sale.acceptedTokensChains[i]),
                            0,
                            0
                        );
                    }
                }
            }

            require(valueSent >= messageFee, "insufficient wormhole messaging fees");
            valueSent -= messageFee;

            // attest sale success on wormhole
            wormholeSequence = wormhole.publishMessage{
                value : messageFee
            }(0, encodeSaleSealed(saleSealed), 15);
        } else {
            // attest sale aborted on wormhole
            wormholeSequence = wormhole.publishMessage{
                value : msg.value
            }(0, encodeSaleAborted(SaleAborted({
                payloadID : 4,
                saleID : saleId
            })), 15);
        }
    }

    function claimRefund(uint saleId) public {
        ConductorStructs.Sale memory sale = sales(saleId);
        require(msg.sender == address(uint160(uint256(sale.refundRecipient))), "not refund recipient");

        require(sale.isAborted, "sale not aborted");
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
}