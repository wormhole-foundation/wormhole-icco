require('dotenv').config({ path: "../.env" });

const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ConductorSetup = artifacts.require("ConductorSetup");
const Wormhole = artifacts.require("Wormhole");
const TokenBridge = artifacts.require("TokenBridge");

const chainId = process.env.ICCO_CONDUCTOR_INIT_CHAIN_ID;

module.exports = async function (deployer) {
    // deploy conductor implementation
    await deployer.deploy(ConductorImplementation);
    // deploy conductor setup
    await deployer.deploy(ConductorSetup);

    // deploy conductor implementation
    await deployer.deploy(ConductorImplementation);

    // deploy conductor setup
    await deployer.deploy(ConductorSetup);

    // encode initialisation data
    const conductorSetup = new web3.eth.Contract(ConductorSetup.abi, ConductorSetup.address);
    const conductorInitData = conductorSetup.methods.setup(
        ConductorImplementation.address,
        chainId,
        (await Wormhole.deployed()).address,
        (await TokenBridge.deployed()).address
    ).encodeABI();

    await deployer.deploy(TokenSaleConductor, ConductorSetup.address, conductorInitData);
};
