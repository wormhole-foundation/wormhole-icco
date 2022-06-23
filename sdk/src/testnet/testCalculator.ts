import { ethers } from "ethers";
import { AcceptedToken } from "../icco";
import { ChainId, tryUint8ArrayToNative, CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import { SaleParams, Contribution } from "./structs";
import { getTokenDecimals } from "./utils";
interface Allocations {
  tokenIndex: number;
  allocation: ethers.BigNumber;
  excessContribution: ethers.BigNumber;
  totalContribution: ethers.BigNumber;
}

interface Results {
  tokenRefund: ethers.BigNumber;
  allocations: Allocations[];
}

export class MockSale {
  conductorChainId: ChainId;
  saleTokenDecimals: number;
  acceptedTokens: AcceptedToken[];
  raiseParams: SaleParams;
  contributions: Contribution[];

  constructor(
    conductorChainId: ChainId,
    denominationDecimals: number,
    acceptedTokens: AcceptedToken[],
    raiseParams: SaleParams,
    contributions: Contribution[]
  ) {
    this.conductorChainId = conductorChainId;
    this.saleTokenDecimals = denominationDecimals;
    this.acceptedTokens = acceptedTokens;
    this.raiseParams = raiseParams;
    this.contributions = contributions;
  }

  sumAllocationsByChain(results: Results): Map<ChainId, ethers.BigNumber> {
    const summedAllocations: Map<ChainId, ethers.BigNumber> = new Map<ChainId, ethers.BigNumber>();

    for (let i = 0; i < this.acceptedTokens.length; i++) {
      const chainId = this.acceptedTokens[i].tokenChain as ChainId;

      if (!summedAllocations.has(chainId)) {
        summedAllocations.set(chainId, results.allocations[i].allocation);
      } else {
        let currentAllocation = summedAllocations.get(chainId);
        summedAllocations.set(chainId, currentAllocation.add(results.allocations[i].allocation));
      }
    }

    return summedAllocations;
  }

  getTokenIndexFromConfig(chainId: ChainId, address: string): number {
    for (let i = 0; i < this.acceptedTokens.length; i++) {
      let nativeTokenAddress = tryUint8ArrayToNative(
        this.acceptedTokens[i].tokenAddress as Uint8Array,
        this.acceptedTokens[i].tokenChain as ChainId
      );

      if (this.acceptedTokens[i].tokenChain !== CHAIN_ID_SOLANA) {
        nativeTokenAddress = ethers.utils.getAddress(nativeTokenAddress);
      }

      if (chainId === (this.acceptedTokens[i].tokenChain as ChainId) && address === nativeTokenAddress) {
        return i;
      }
    }
  }

  normalizeAmount(amount: ethers.BigNumber, decimals: ethers.BigNumber): ethers.BigNumber {
    let maxDecimals = ethers.BigNumber.from("8");
    if (decimals.gt(maxDecimals)) {
      return amount.div(ethers.BigNumber.from("10").pow(decimals.sub(maxDecimals)));
    } else {
      return amount;
    }
  }

  denormalizeAmount(amount: ethers.BigNumber, decimals: ethers.BigNumber): ethers.BigNumber {
    let maxDecimals = ethers.BigNumber.from("8");
    if (decimals.gt(maxDecimals)) {
      return amount.mul(ethers.BigNumber.from("10").pow(decimals.sub(maxDecimals)));
    } else {
      return amount;
    }
  }

  async sumContributions(): Promise<ethers.BigNumber[]> {
    // create array of size acceptedTokens.length of zeros
    const rawTotals = new Array<ethers.BigNumber>(this.acceptedTokens.length).fill(ethers.BigNumber.from(0));

    // create map
    for (const contribution of this.contributions) {
      const tokenIndex = this.getTokenIndexFromConfig(contribution.chainId, contribution.address);
      const tokenDecimals = await getTokenDecimals(contribution.chainId as ChainId, contribution.address);
      const contributionAmount = ethers.utils.parseUnits(contribution.amount, tokenDecimals);
      // add the contribution to the running total
      rawTotals[tokenIndex] = rawTotals[tokenIndex].add(contributionAmount);
    }
    return rawTotals;
  }

  calculateTotalRaised(totalContributions: ethers.BigNumber[]): ethers.BigNumber {
    let totalRaised = ethers.BigNumber.from(0);

    for (let i = 0; i < totalContributions.length; i++) {
      const scaledContribution = totalContributions[i]
        .mul(this.acceptedTokens[i].conversionRate)
        .div(ethers.utils.parseEther("1"));
      totalRaised = totalRaised.add(scaledContribution);
    }
    return totalRaised;
  }

  async calculateResults(totalContributions: ethers.BigNumber[]): Promise<Results> {
    const minRaise = ethers.utils.parseUnits(this.raiseParams.minRaise, this.saleTokenDecimals);
    const maxRaise = ethers.utils.parseUnits(this.raiseParams.maxRaise, this.saleTokenDecimals);
    let saleTokenAmount = ethers.utils.parseUnits(this.raiseParams.tokenAmount, this.saleTokenDecimals);
    let totalRaised = this.calculateTotalRaised(totalContributions);
    let totalAllocated = ethers.BigNumber.from(0);

    // calculate the token refund to send to reFundRecipient
    // and the total excess contribution (if applicable)
    let tokenRefund = ethers.BigNumber.from(0);
    let totalExcessContribution = ethers.BigNumber.from(0);
    if (!totalRaised.gte(maxRaise)) {
      tokenRefund = saleTokenAmount.sub(saleTokenAmount.mul(totalRaised).div(maxRaise));
      saleTokenAmount = saleTokenAmount.sub(tokenRefund);
    } else {
      totalExcessContribution = totalRaised.sub(maxRaise);
    }

    // allocations container
    const allocations: Allocations[] = [];

    // compute the allocations
    for (let i = 0; i < totalContributions.length; i++) {
      const scaledContribution = totalContributions[i]
        .mul(this.acceptedTokens[i].conversionRate)
        .div(ethers.utils.parseEther("1"));

      let allocation = ethers.BigNumber.from(0);
      let excessContribution = ethers.BigNumber.from(0);
      let normalizedTotalContribution = totalContributions[i];
      if (totalRaised.gte(minRaise)) {
        allocation = saleTokenAmount.mul(scaledContribution).div(totalRaised);
        excessContribution = totalExcessContribution.mul(totalContributions[i]).div(totalRaised);

        if ((this.acceptedTokens[i].tokenChain as ChainId) !== this.conductorChainId) {
          // normalize the bridge transfers
          allocation = this.denormalizeAmount(
            this.normalizeAmount(allocation, ethers.BigNumber.from(this.saleTokenDecimals)),
            ethers.BigNumber.from(this.saleTokenDecimals)
          );

          // normalize the contribution amount for foreign contributors
          const nativeAddress = await tryUint8ArrayToNative(
            this.acceptedTokens[i].tokenAddress as Uint8Array,
            this.acceptedTokens[i].tokenChain as ChainId
          );
          const contributedTokenDecimals = ethers.BigNumber.from(
            await getTokenDecimals(this.acceptedTokens[i].tokenChain as ChainId, nativeAddress)
          );
          normalizedTotalContribution = this.denormalizeAmount(
            this.normalizeAmount(totalContributions[i], contributedTokenDecimals),
            contributedTokenDecimals
          );
        }
        // create the allocation
        allocations.push({
          tokenIndex: i,
          allocation: allocation,
          excessContribution: excessContribution,
          totalContribution: normalizedTotalContribution,
        });
      }
      // keep running total of allocations
      totalAllocated = totalAllocated.add(allocation);
    }

    // store the results and return
    const results: Results = {
      tokenRefund: tokenRefund.add(saleTokenAmount.sub(totalAllocated)),
      allocations: allocations,
    };

    return results;
  }

  async getResults(): Promise<Results> {
    const totalContributions: ethers.BigNumber[] = await this.sumContributions();
    return await this.calculateResults(totalContributions);
  }
}
