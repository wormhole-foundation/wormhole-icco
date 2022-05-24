import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Contributor } from "../target/types/contributor";


describe("icco", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.contributor as Program<Contributor>;
  console.log(program.programId);
  
  
  it("creates a contributor", async () => {
    await program.methods.initialize().accounts({}).rpc();
  });
}); 
