require("dotenv").config({ path: "../.env" });

const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ConductorSetup = artifacts.require("ConductorSetup");
const ICCOStructs = artifacts.require("ICCOStructs");

const ethereumRootPath = `${__dirname}/..`;
const WormholeAddresses = require(`${ethereumRootPath}/wormhole-addresses.js`);

const chainId = process.env.CONDUCTOR_CHAIN_ID;

const fs = require("fs");

module.exports = async function (deployer, network) {
  const addresses = WormholeAddresses[network];
  if (!addresses) {
    throw Error("wormhole and token bridge addresses undefined");
  }

  // deploy ICCOStructs library
  await deployer.deploy(ICCOStructs);
  await deployer.link(ICCOStructs, ConductorImplementation);

  // deploy conductor implementation
  await deployer.deploy(ConductorImplementation);

  // deploy conductor setup
  await deployer.deploy(ConductorSetup);

  // encode initialisation data
  const conductorSetup = new web3.eth.Contract(
    ConductorSetup.abi,
    ConductorSetup.address
  );
  const conductorInitData = conductorSetup.methods
    .setup(
      ConductorImplementation.address,
      chainId,
      addresses.wormhole,
      addresses.tokenBridge
    )
    .encodeABI();

  // deploy conductor proxy
  await deployer.deploy(
    TokenSaleConductor,
    ConductorSetup.address,
    conductorInitData
  );

  // cache address depending on whether contract
  // has been deployed to mainnet, testnet or devnet
  // NB: there should only be one conductor living
  // among all the icco contracts. So there should only
  // be three network conditionals, one for each
  // mainnet, testnet and devnet

  // devnet
  if (network == "eth_devnet") {
    const fp = `${ethereumRootPath}/../tilt.json`;

    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : {};
    contents.conductorAddress = TokenSaleConductor.address;
    contents.conductorChain = parseInt(chainId);
    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }

  // TODO: testnet
  if (network == "goerli") {
  }

  // TODO: mainnet
  if (network == "mainnet") {
  }
};
