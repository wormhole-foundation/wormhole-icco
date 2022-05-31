import { Program } from "@project-serum/anchor";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import { KeyBump } from "./accounts";

export async function getSaleState(program: Program<AnchorContributor>, saleAccount: KeyBump) {
  return program.account.sale.fetch(saleAccount.key);
}

export async function getBuyerState(program: Program<AnchorContributor>, buyerAccount: KeyBump) {
  return program.account.buyer.fetch(buyerAccount.key);
}
