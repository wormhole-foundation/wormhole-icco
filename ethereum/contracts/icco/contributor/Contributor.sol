// contracts/Contributor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../libraries/external/BytesLib.sol";

import "./ContributorGetters.sol";
import "./ContributorSetters.sol";
import "./ContributorStructs.sol";
import "./ContributorGovernance.sol";

import "../shared/ICCOStructs.sol";

contract Contributor is ContributorGovernance, ICCOStructs {
    function initSale(bytes memory saleInitVaa) public {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleInitVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        SaleInit memory saleInit = parseSaleInit(vm.payload);

        require(saleInit.tokenChain == conductorChainId(), "tokenChain != conductorChainId");
        // REVIEW: should we add the following require statements?
        require(saleInit.saleStart < saleInit.saleEnd, "sale end must be after sale start");
        require(saleInit.tokenAmount > 0, "amount must be > 0");
        require(saleInit.acceptedTokens.length > 0, "must accept at least one token");
        require(saleInit.acceptedTokens.length < 255, "too many tokens");

        ContributorStructs.Sale memory sale = ContributorStructs.Sale({
            saleID : saleInit.saleID,
            tokenAddress : saleInit.tokenAddress,
            tokenChain : saleInit.tokenChain,
            tokenAmount : saleInit.tokenAmount,
            minRaise : saleInit.minRaise,
            saleStart : saleInit.saleStart,
            saleEnd : saleInit.saleEnd,
            acceptedTokensChains : new uint16[](saleInit.acceptedTokens.length),
            acceptedTokensAddresses : new bytes32[](saleInit.acceptedTokens.length),
            acceptedTokensConversionRates : new uint256[](saleInit.acceptedTokens.length),
            recipient : saleInit.recipient,
            refundRecipient : saleInit.refundRecipient,
            isSealed : false,
            isAborted : false,
            allocations : new uint256[](saleInit.acceptedTokens.length)
        });

        for (uint i = 0; i < saleInit.acceptedTokens.length; i++) {
            // REVIEW: should we also check this like in the Conductor?
            require(saleInit.acceptedTokens[i].conversionRate > 0, "conversion rate cannot be zero");

            // REVIEW: check if the token is a legitimate erc20 on this chain
            if (saleInit.acceptedTokens[i].tokenChain == chainId()) {
                address tokenAddress = address(uint160(uint256(saleInit.acceptedTokens[i].tokenAddress)));
                (, bytes memory queriedTotalSupply) = tokenAddress.staticcall(abi.encodeWithSelector(IERC20.totalSupply.selector));
                require(queriedTotalSupply.length > 0, "non-existent ERC20");
            }

            sale.acceptedTokensChains[i] = saleInit.acceptedTokens[i].tokenChain;
            sale.acceptedTokensAddresses[i] = saleInit.acceptedTokens[i].tokenAddress;
            sale.acceptedTokensConversionRates[i] = saleInit.acceptedTokens[i].conversionRate;
        }

        setSale(saleInit.saleID, sale);
    }

    function contribute(uint saleId, uint tokenIndex, uint amount) public {
        (, bool isAborted) = getSaleStatus(saleId);

        require(!isAborted, "sale was aborted");

        (uint start, uint end) = getSaleTimeframe(saleId);

        require(block.timestamp >= start, "sale not yet started");
        require(block.timestamp <= end, "sale has ended");

        (uint16 tokenChain, bytes32 tokenAddressBytes,) = getSaleAcceptedTokenInfo(saleId, tokenIndex);

        require(tokenChain == chainId(), "this token can not be contributed on this chain");

        address tokenAddress = address(uint160(uint256(tokenAddressBytes)));

        // query own token balance before transfer
        (, bytes memory queriedBalanceBefore) = tokenAddress.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        uint256 balanceBefore = abi.decode(queriedBalanceBefore, (uint256));

        // deposit tokens
        SafeERC20.safeTransferFrom(IERC20(tokenAddress), msg.sender, address(this), amount);

        // query own token balance after transfer
        (, bytes memory queriedBalanceAfter) = tokenAddress.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        uint256 balanceAfter = abi.decode(queriedBalanceAfter, (uint256));

        // revert if token has fee
        require(amount == balanceAfter - balanceBefore, "fee-on-transfer tokens are not supported");

        // store contribution
        setSaleContribution(saleId, msg.sender, tokenIndex, amount);
    }

    function attestContributions(uint saleId) public payable returns (uint wormholeSequence) {
        ContributorStructs.Sale memory sale = sales(saleId);

        require(sale.tokenAddress != bytes32(0), "sale not initialized");
        require(block.timestamp > sale.saleEnd, "sale has not yet ended");
        require(!sale.isAborted, "sale was aborted");

        uint nativeTokens = 0;
        uint chainId = chainId(); // cache from storage
        for (uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
            if (sale.acceptedTokensChains[i] == chainId) {
                nativeTokens++;
            }
        }

        ContributionsSealed memory consSealed = ContributionsSealed({
            payloadID : 2,
            saleID : saleId,
            chainID : uint16(chainId),
            contributions : new Contribution[](nativeTokens)
        });

        uint ci = 0;
        for (uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
            if (sale.acceptedTokensChains[i] == chainId) {
                consSealed.contributions[ci].tokenIndex = uint8(i);
                consSealed.contributions[ci].contributed = getSaleTotalContribution(saleId, i);
                ci++;
            }
        }

        wormholeSequence = wormhole().publishMessage{
            value : msg.value
        }(0, encodeContributionsSealed(consSealed), 15);
    }

    function saleSealed(bytes memory saleSealedVaa) public payable {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleSealedVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        SaleSealed memory sSealed = parseSaleSealed(vm.payload); 

        // check to see if the sale was aborted already
        (bool isSealed, bool isAborted) = getSaleStatus(sSealed.saleID);

        require(!isSealed && !isAborted, "already sealed / aborted");

        // confirm the allocated sale tokens are in this contract
        ContributorStructs.Sale memory sale = sales(sSealed.saleID);
        uint16 thisChainId = chainId(); // cache from storage

        {
            address saleTokenAddress;
            if (sale.tokenChain == chainId()) {
                // normal token transfer on same chain
                saleTokenAddress = address(uint160(uint256(sale.tokenAddress)));
            } else {
                // identify wormhole token bridge wrapper
                saleTokenAddress = tokenBridge().wrappedAsset(sale.tokenChain, sale.tokenAddress);
                require(saleTokenAddress != address(0), "sale token is not attested");
            }

            (, bytes memory queriedTokenBalance) = saleTokenAddress.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
            uint tokenBalance = abi.decode(queriedTokenBalance, (uint256));

            require(tokenBalance > 0, "sale token balance must be non-zero");

            uint tokenAllocation;
            for (uint i = 0; i < sSealed.allocations.length; i++) {
                Allocation memory allo = sSealed.allocations[i];
                if (sale.acceptedTokensChains[allo.tokenIndex] == thisChainId) {
                    tokenAllocation += allo.allocation;
                    setSaleAllocation(sSealed.saleID, allo.tokenIndex, allo.allocation);
                }
            }

            require(tokenBalance >= tokenAllocation, "insufficient sale token balance");
            setSaleSealed(sSealed.saleID);
        }

        uint16 conductorChainId = conductorChainId();
        if (conductorChainId == thisChainId) {
            // raised funds are payed out on this chain
            for (uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
                if (sale.acceptedTokensChains[i] == thisChainId) {
                    SafeERC20.safeTransfer(
                        IERC20(address(uint160(uint256(sale.acceptedTokensAddresses[i])))),
                        address(uint160(uint256(sale.recipient))),
                        getSaleTotalContribution(sale.saleID, i)
                    );
                }
            }
        } else {
            // raised funds are payed out to recipient over wormhole token bridge
            BridgeImplementation tknBridge = tokenBridge();
            uint messageFee = wormhole().messageFee();
            uint valueSent = msg.value;

            for (uint i = 0; i < sale.acceptedTokensAddresses.length; i++) {
                if (sale.acceptedTokensChains[i] == thisChainId) {
                    uint totalContributions = (getSaleTotalContribution(sale.saleID, i) / 1e10) * 1e10;

                    // transfer over wormhole token bridge
                    SafeERC20.safeApprove(IERC20(address(uint160(uint256(sale.acceptedTokensAddresses[i])))), address(tknBridge), totalContributions);

                    require(valueSent >= messageFee, "insufficient wormhole messaging fees");
                    valueSent -= messageFee;

                    tknBridge.transferTokens{
                        value : messageFee
                    }(
                        address(uint160(uint256(sale.acceptedTokensAddresses[i]))),
                        totalContributions,
                        conductorChainId,
                        sale.recipient,
                        0,
                        0
                    );
                    SafeERC20.safeApprove(IERC20(address(uint160(uint256(sale.acceptedTokensAddresses[i])))), address(tknBridge), 0);
                }
            }
        }
    }

    function saleAborted(bytes memory saleAbortedVaa) public {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole().parseAndVerifyVM(saleAbortedVaa);

        require(valid, reason);
        require(verifyConductorVM(vm), "invalid emitter");

        SaleAborted memory saleInit = parseSaleAborted(vm.payload);

        setSaleAborted(saleInit.saleID);
    }

    function claimAllocation(uint saleId, uint tokenIndex) public {
        (bool isSealed, bool isAborted) = getSaleStatus(saleId);

        require(!isAborted, "token sale is aborted");
        require(isSealed, "token sale is not yet sealed");

        require(allocationIsClaimed(saleId, tokenIndex, msg.sender) == false, "allocation already claimed");

        (uint16 contributedTokenChainId, , ) = getSaleAcceptedTokenInfo(saleId, tokenIndex);

        require(contributedTokenChainId == chainId(), "allocation needs to be claimed on a different chain");

        setAllocationClaimed(saleId, tokenIndex, msg.sender);

        uint256 thisAllocation = (getSaleAllocation(saleId, tokenIndex) * getSaleContribution(saleId, tokenIndex, msg.sender)) / getSaleTotalContribution(saleId, tokenIndex);

        ContributorStructs.Sale memory sale = sales(saleId);

        address tokenAddress;
        if (sale.tokenChain == chainId()) {
            // normal token transfer on same chain
            tokenAddress = address(uint160(uint256(sale.tokenAddress)));
        } else {
            // identify wormhole token bridge wrapper
            tokenAddress = tokenBridge().wrappedAsset(sale.tokenChain, sale.tokenAddress);
            require(tokenAddress != address(0), "sale token is not attested");
        }

        SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, thisAllocation);
    }

    function claimRefund(uint saleId, uint tokenIndex) public {
        (, bool isAborted) = getSaleStatus(saleId);

        require(isAborted, "token sale is not aborted");

        require(refundIsClaimed(saleId, tokenIndex, msg.sender) == false, "refund already claimed");

        setRefundClaimed(saleId, tokenIndex, msg.sender);

        (uint16 tokenChainId, bytes32 tokenAddressBytes, ) = getSaleAcceptedTokenInfo(saleId, tokenIndex);
        address tokenAddress = address(uint160(uint256(tokenAddressBytes)));

        require(tokenChainId == uint16(chainId()), "refund needs to be claimed on another chain");

        // refund tokens
        SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, getSaleContribution(saleId, tokenIndex, msg.sender));
    }

    function verifyConductorVM(IWormhole.VM memory vm) internal view returns (bool) {
        if (conductorContract() == vm.emitterAddress && conductorChainId() == vm.emitterChainId) {
            return true;
        }

        return false;
    }
}
