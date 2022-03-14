require('dotenv').config({ path: "../.env" });

const TokenSaleContributor = artifacts.require("TokenSaleContributor");
const ContributorImplementation = artifacts.require("ContributorImplementation");
const ContributorSetup = artifacts.require("ContributorSetup");

const TokenSaleConductor = artifacts.require("TokenSaleConductor");

const Wormhole = artifacts.require("Wormhole");
const TokenBridge = artifacts.require("TokenBridge");

const chainId = process.env.ICCO_CONTRIBUTOR_INIT_CHAIN_ID;
const conductorChainId = process.env.ICCO_CONDUCTOR_INIT_CHAIN_ID;
const governanceChainId = process.env.ICCO_CONTRIBUTOR_INIT_GOV_CHAIN_ID;
const governanceContract = process.env.ICCO_CONTRIBUTOR_INIT_GOV_CONTRACT; // bytes32

module.exports = async function (deployer) {
    // deploy contributor implementation
    await deployer.deploy(ContributorImplementation);

    // deploy contributor setup
    await deployer.deploy(ContributorSetup);

    // encode initialisation data
    const contributorSetup = new web3.eth.Contract(ContributorSetup.abi, ContributorSetup.address);
    const contributorInitData = contributorSetup.methods.setup(
        ContributorImplementation.address,
        chainId,
        conductorChainId,
        "0x000000000000000000000000" + (await TokenSaleConductor.deployed()).address.substr(2),
        (await Wormhole.deployed()).address,
        (await TokenBridge.deployed()).address,
        governanceChainId,
        governanceContract
    ).encodeABI();

    // deploy conductor proxy
    await deployer.deploy(TokenSaleContributor, ContributorSetup.address, contributorInitData);
};
