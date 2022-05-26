const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ConductorSetup = artifacts.require("ConductorSetup");
const ICCOStructs = artifacts.require("ICCOStructs");

const ethereumRootPath = `${__dirname}/..`;
const DeploymentConfig = require(`${ethereumRootPath}/icco_deployment_config.js`);

const fs = require("fs");

module.exports = async function(deployer, network) {
  const config = DeploymentConfig[network];
  if (!config) {
    throw Error("deployment config undefined");
  }

  // deploy ICCOStructs library
  await deployer.deploy(ICCOStructs);
  await deployer.link(ICCOStructs, ConductorImplementation);

  // deploy conductor implementation
  await deployer.deploy(ConductorImplementation);

  if (!config.deployImplementationOnly) {
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
        config.conductorChainId,
        config.wormhole,
        config.tokenBridge,
        config.consistencyLevel
      )
      .encodeABI();

    // deploy conductor proxy
    await deployer.deploy(
      TokenSaleConductor,
      ConductorSetup.address,
      conductorInitData
    );
  }

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
    contents.conductorChain = parseInt(config.conductorChainId);
    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }

  // testnet deployments
  if (network == "goerli") {
    const fp = `${ethereumRootPath}/../testnet.json`;

    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : {};
    if (!config.deployImplementationOnly) {
      contents.conductorAddress = TokenSaleConductor.address;
      contents.conductorChain = parseInt(config.conductorChainId);
    } else {
      const implementationString = network.concat("ConductorImplementation");
      contents[implementationString] = ConductorImplementation.address;
    }

    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }
};
