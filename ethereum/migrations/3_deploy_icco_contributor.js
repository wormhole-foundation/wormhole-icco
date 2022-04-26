require("dotenv").config({ path: "../.env" });

const TokenSaleContributor = artifacts.require("TokenSaleContributor");
const ContributorImplementation = artifacts.require(
  "ContributorImplementation"
);
const ContributorSetup = artifacts.require("ContributorSetup");
const ICCOStructs = artifacts.require("ICCOStructs");

const ethereumRootPath = `${__dirname}/..`;
const WormholeAddresses = require(`${ethereumRootPath}/wormhole-addresses.js`);

const chainId = process.env.CONTRIBUTOR_CHAIN_ID;
const conductorChainId = process.env.CONDUCTOR_CHAIN_ID;
const kycSigner = process.env.KYC_SIGNER;
const consistencyLevel = process.env.CONSISTENCY_LEVEL;

const fs = require("fs");

module.exports = async function (deployer, network) {
  const addresses = WormholeAddresses[network];
  if (!addresses) {
    throw Error("wormhole and token bridge addresses undefined");
  }

  // deploy ICCOStructs library and link to the implementation
  await deployer.deploy(ICCOStructs);
  await deployer.link(ICCOStructs, ContributorImplementation);

  // deploy contributor implementation
  await deployer.deploy(ContributorImplementation);

  // deploy contributor setup
  await deployer.deploy(ContributorSetup);

  // encode initialisation data
  const contributorSetup = new web3.eth.Contract(
    ContributorSetup.abi,
    ContributorSetup.address
  );

  // figure out which conductor address to use
  let conductorAddress = undefined;
  if (network == "development") {
    const TokenSaleConductor = artifacts.require("TokenSaleConductor");
    conductorAddress =
      "0x000000000000000000000000" +
      (await TokenSaleConductor.deployed()).address.substring(2);
  } else if (network == "eth_devnet" || network == "eth_devnet2") {
    const fp = `${ethereumRootPath}/../tilt.json`;
    conductorAddress =
      "0x000000000000000000000000" +
      JSON.parse(fs.readFileSync(fp, "utf8")).conductorAddress.substring(2);
  }

  if (!conductorAddress) {
    throw Error("conductorAddress is undefined");
  }

  const contributorInitData = contributorSetup.methods
    .setup(
      ContributorImplementation.address,
      chainId,
      conductorChainId,
      conductorAddress,
      kycSigner,
      addresses.wormhole,
      addresses.tokenBridge,
      consistencyLevel,
    )
    .encodeABI();

  // deploy conductor proxy
  await deployer.deploy(
    TokenSaleContributor,
    ContributorSetup.address,
    contributorInitData
  );

  // cache address for registration purposes
  {
    let fp = undefined;
    let addrName = undefined;
    if (network == "eth_devnet") {
      fp = `${ethereumRootPath}/../tilt.json`;
      addrName = "ethContributorAddress";
    } else if (network == "eth_devnet2") {
      fp = `${ethereumRootPath}/../tilt.json`;
      addrName = "bscContributorAddress";
    }

    if (!!fp) {
      const contents = fs.existsSync(fp)
        ? JSON.parse(fs.readFileSync(fp, "utf8"))
        : {};
      contents[addrName] = TokenSaleContributor.address;
      fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
    }
  }

  if (!network.startsWith("eth_devnet")) {
    return;
  }

  /*
  // write address for integration test
  {
    const addrName =
      network == "eth_devnet"
        ? "ethContributorAddress"
        : "bscContributorAddress";

    const fp = `${tiltTestPath}/tilt.json`;

    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : {};
    contents[addrName] = TokenSaleContributor.address;
    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }
  */
};
