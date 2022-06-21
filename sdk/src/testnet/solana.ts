import { AnchorProvider, web3, Program } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import AnchorContributorIdl from "../../target/idl/anchor_contributor.json";

export function connectToContributorProgram(
  rpc: string,
  wallet: web3.Keypair,
  programId: web3.PublicKey
): Program<AnchorContributor> {
  const program = new Program<AnchorContributor>(
    AnchorContributorIdl as any,
    programId,
    new AnchorProvider(new web3.Connection(rpc), new NodeWallet(wallet), {})
  );
  return program;
}
