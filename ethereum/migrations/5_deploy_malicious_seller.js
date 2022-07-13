const seller = artifacts.require("MaliciousSeller");

module.exports = async function(deployer, network, accounts) {
  await deployer.deploy(seller);
};
