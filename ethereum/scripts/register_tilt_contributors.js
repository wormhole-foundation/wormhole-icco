// run this script with truffle exec

const jsonfile = require("jsonfile");
const elliptic = require("elliptic");
const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const TokenSaleContributor = artifacts.require("TokenSaleContributor");

const ConductorImplementationFullABI = jsonfile.readFileSync(
  "../build/contracts/ConductorImplementation.json"
).abi;

const fs = require("fs");

const tilt = JSON.parse(
  fs.readFileSync(`${__dirname}/../../tilt.json`, "utf8")
);

module.exports = async function(callback) {
  try {
    const emitters = new Map();
    {
      // TODO: grab this from the tilt.json file...
      // const solanaProgAddr = "22mamxmojFWBdbGqaxTH46HBAgAY2bJRiGJJHfNRNQ95";  //TBD Not used, because I could not get WH sdk to be available in tilt.
      const solanaEmitterAddr =
        "0xaeab35a8d36bbaad38154ca4ca6a0770e7009326316d59ef2c8a2123e90d174c"; // Derived from solanaProgAddr using await sdk.getEmitterAddressSolana(..);

      // Build chainId -> ContributorAddr map.
      const ethEmitterAddress =
        "0x000000000000000000000000" + tilt.ethContributorAddress.substring(2);
      const bscEmitterAddress =
        "0x000000000000000000000000" + tilt.bscContributorAddress.substring(2);
      emitters.set(1, solanaEmitterAddr);
      emitters.set(2, ethEmitterAddress);
      emitters.set(4, bscEmitterAddress);
    }

    // register all chainId -> ContributorAddr with conductor.
    for (const [chainId, emitter] of emitters.entries()) {
      console.log("Registering chainId: ", chainId, " emitter: ", emitter);

      const accounts = await web3.eth.getAccounts();
      const initialized = new web3.eth.Contract(
        ConductorImplementationFullABI,
        TokenSaleConductor.address
      );

      // Register the ETH contributor
      await initialized.methods.registerChain(chainId, emitter).send({
        value: 0,
        from: accounts[0], // must be account zero (owner is account[0])
        gasLimit: 2000000,
      });
    }
    callback();
  } catch (e) {
    callback(e);
  }
};
