import { AnchorProvider, web3, Program } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { AnchorContributor } from "../../target/types/anchor_contributor";
import AnchorContributorIdl from "../../target/idl/anchor_contributor.json";

export function connectToContributorProgram(
  connection: web3.Connection,
  wallet: web3.Keypair,
  programId: web3.PublicKey,
  options: web3.ConfirmOptions = {}
): Program<AnchorContributor> {
  const program = new Program<AnchorContributor>(
    AnchorContributorIdl as any,
    programId,
    new AnchorProvider(connection, new NodeWallet(wallet), options)
  );
  return program;
}
