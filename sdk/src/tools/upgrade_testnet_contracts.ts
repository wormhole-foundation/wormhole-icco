import yargs from "yargs";
import { ethers } from "ethers";
import { Conductor__factory, Contributor__factory } from "../";

const fs = require("fs");
const DeploymentConfig = require("../../../ethereum/icco_deployment_config.js");

function parseArgs(): string[] {
  const parsed = yargs(process.argv.slice(2))
    .options("contractType", {
      type: "string",
      description: "Type of contract (e.g. conductor)",
      require: true,
    })
    .options("network", {
      type: "string",
      description: "Network to deploy to (e.g. goerli)",
      require: true,
    })
    .help("h")
    .alias("h", "help").argv;

  const args = [parsed.contractType, parsed.network];
  return args;
}

async function main() {
  const args = parseArgs();

  // create checksum address
  const contractType = args[0];
  const network = args[1];

  const config = DeploymentConfig[network];
  if (!config) {
    throw Error("deployment config undefined");
  }

  const testnet = JSON.parse(fs.readFileSync(`${__dirname}/../../testnet.json`, "utf8"));

  // create wallet to call sdk method with
  const provider = new ethers.providers.JsonRpcProvider(config.rpc);
  const wallet: ethers.Wallet = new ethers.Wallet(config.mnemonic, provider);

  // create the factory and grab the implementation address
  let contractFactory;
  let chainId;
  let newImplementation;

  if (contractType == "conductor") {
    contractFactory = Conductor__factory.connect(testnet["conductorAddress"], wallet);
    chainId = config.conductorChainId;
    newImplementation = testnet[network.concat("ConductorImplementation")];
  } else {
    contractFactory = Contributor__factory.connect(testnet[network], wallet);
    chainId = config.contributorChainId;
    newImplementation = testnet[network.concat("ContributorImplementation")];
  }

  // run the upgrade
  const tx = await contractFactory.upgrade(chainId, newImplementation);
  const receipt = await tx.wait();

  console.log("transction:", receipt.transactionHash, ", newImplementation:", newImplementation);

  return;
}

main();
