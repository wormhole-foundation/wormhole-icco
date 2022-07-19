const jsonfile = require("jsonfile");
const elliptic = require("elliptic");
const { assert } = require("chai");
const ethers = require("ethers");

require("@openzeppelin/test-helpers/configure")({ provider: web3.currentProvider, environment: "truffle" });
const { singletons } = require("@openzeppelin/test-helpers");
const { ZERO_BYTES32 } = require("@openzeppelin/test-helpers/src/constants");

const TokenERC777 = artifacts.require("TokenERC777");
const MaliciousSeller = artifacts.require("MaliciousSeller");

const TokenImplementation = artifacts.require("TokenImplementation");

const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const TokenSaleContributor = artifacts.require("TokenSaleContributor");
const MockConductorImplementation = artifacts.require("MockConductorImplementation");
const MockContributorImplementation = artifacts.require("MockContributorImplementation");
const ICCOStructs = artifacts.require("ICCOStructs");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ContributorImplementation = artifacts.require("ContributorImplementation");

// library upgrade test
const MockICCOStructs = artifacts.require("MockICCOStructs");
const MockConductorImplementation2 = artifacts.require("MockConductorImplementation2");
const MockContributorImplementation2 = artifacts.require("MockContributorImplementation2");

const testSigner1PK = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
const kycSignerPK = "b0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773";

const WormholeImplementationFullABI = jsonfile.readFileSync("wormhole/ethereum/build/contracts/Implementation.json")
  .abi;
const ConductorImplementationFullABI = jsonfile.readFileSync("build/contracts/ConductorImplementation.json").abi;
const ContributorImplementationFullABI = jsonfile.readFileSync("build/contracts/ContributorImplementation.json").abi;

// global variables
const SOLANA_CHAIN_ID = "1";
const TEST_CHAIN_ID = "2";
const GAS_LIMIT = "3000000";

const ethereumRootPath = `${__dirname}/..`;
const config = require(`${ethereumRootPath}/icco_deployment_config.js`).development;

contract("ICCO", function(accounts) {
  const WORMHOLE = new web3.eth.Contract(WormholeImplementationFullABI, config.wormhole);
  const CONDUCTOR_BYTES32_ADDRESS = "0x000000000000000000000000" + TokenSaleConductor.address.substr(2);
  const KYC_AUTHORITY = "0x1dF62f291b2E969fB0849d99D9Ce41e2F137006e";
  const ZERO_ADDRESS = ethers.constants.AddressZero;
  const WORMHOLE_FEE = 1000;

  it("should set wormhole fee", async function() {
    console.log("\n       -------------------------- Set Wormhole Messaging Fee --------------------------");
    const timestamp = 1000;
    const nonce = 1001;
    const emitterChainId = "1";
    const emitterAddress = "0x0000000000000000000000000000000000000000000000000000000000000004";
    const newMessageFee = WORMHOLE_FEE;

    data = [
      //Core
      "0x" +
        Buffer.from("Core")
          .toString("hex")
          .padStart(64, 0),
      // Action 3 (Set Message Fee)
      "03",
      // ChainID
      web3.eth.abi.encodeParameter("uint16", "2").substring(2 + (64 - 4)),
      // Message Fee
      web3.eth.abi.encodeParameter("uint256", newMessageFee).substring(2),
    ].join("");

    const vm = await signAndEncodeVM(timestamp, nonce, emitterChainId, emitterAddress, 0, data, [testSigner1PK], 0, 2);

    let before = await WORMHOLE.methods.messageFee().call();

    await WORMHOLE.methods.submitSetMessageFee("0x" + vm).send({
      value: 0,
      from: accounts[0],
      gasLimit: 1000000,
    });

    let after = await WORMHOLE.methods.messageFee().call();

    assert.notEqual(before, after);
    assert.equal(after, newMessageFee);
  });

  it("conductor should be initialized with the correct values", async function() {
    console.log("\n       -------------------------- Initialization and Upgrades --------------------------");
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // chain id
    const chainId = await initialized.methods.chainId().call();
    assert.equal(chainId, TEST_CHAIN_ID);

    // wormhole
    const WORMHOLE = await initialized.methods.wormhole().call();
    assert.equal(WORMHOLE, config.wormhole);

    // tokenBridge
    const tokenbridge = await initialized.methods.tokenBridge().call();
    assert.equal(tokenbridge, config.tokenBridge);
  });

  it("contributor should be initialized with the correct values", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // chain id
    const chainId = await initialized.methods.chainId().call();
    assert.equal(chainId, TEST_CHAIN_ID);

    // conductor
    const conductorChainId = await initialized.methods.conductorChainId().call();
    assert.equal(conductorChainId, TEST_CHAIN_ID);
    const conductorContract = await initialized.methods.conductorContract().call();
    assert.equal(conductorContract.substr(26).toLowerCase(), TokenSaleConductor.address.substr(2).toLowerCase());

    // wormhole
    const WORMHOLE = await initialized.methods.wormhole().call();
    assert.equal(WORMHOLE, config.wormhole);

    // tokenBridge
    const tokenbridge = await initialized.methods.tokenBridge().call();
    assert.equal(tokenbridge, config.tokenBridge);
  });

  it("conductor should register a contributor implementation correctly", async function() {
    const contributorAddress = web3.eth.abi.encodeParameter(
      "bytes32",
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2)
    );

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    let before = await initialized.methods.contributorContracts(TEST_CHAIN_ID).call();

    assert.equal(before, "0x0000000000000000000000000000000000000000000000000000000000000000");

    // attempt to register a chain from non-owner account
    let failed = false;
    try {
      await initialized.methods.registerChain(TEST_CHAIN_ID, contributorAddress).send({
        value: 0,
        from: accounts[1],
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      failed = true;
    }

    assert.ok(failed);

    const tx = await initialized.methods.registerChain(TEST_CHAIN_ID, contributorAddress).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    let after = await initialized.methods.contributorContracts(TEST_CHAIN_ID).call();

    assert.equal(after.substr(26).toLowerCase(), TokenSaleContributor.address.substr(2).toLowerCase());

    // attempt to register a contributor a second time
    failed = false;
    try {
      await initialized.methods.registerChain(TEST_CHAIN_ID, contributorAddress).send({
        value: 0,
        from: accounts[0],
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert chain already registered"
      );
      failed = true;
    }
  });

  it("conductor should accept a valid upgrade", async function() {
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // deploy mock contracts and link ICCOStructs library
    const structs = await ICCOStructs.new();
    await MockConductorImplementation.link(structs, structs.address);
    const mock = await MockConductorImplementation.new();

    // attempt to upgrade a chain from non-owner account
    let failed = false;
    try {
      await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
        value: 0,
        from: accounts[1],
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      failed = true;
    }

    assert.ok(failed);

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleConductor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(before.toLowerCase(), ConductorImplementation.address.toLowerCase());

    const upgradeTx = await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    let after = await web3.eth.getStorageAt(
      TokenSaleConductor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(after.toLowerCase(), mock.address.toLowerCase());

    // confirm that the ContractUpgraded event is emitted
    let eventOutput = upgradeTx["events"]["ContractUpgraded"]["returnValues"];

    assert.equal(eventOutput["oldContract"].toLowerCase(), before.toLowerCase());
    assert.equal(eventOutput["newContract"].toLowerCase(), after.toLowerCase());

    const mockImpl = new web3.eth.Contract(MockConductorImplementation.abi, TokenSaleConductor.address);

    let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();

    assert.ok(isUpgraded);
  });

  it("contributor should accept a valid upgrade", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // deploy mock contracts and link ICCOStructs library
    const structs = await ICCOStructs.new();
    await MockContributorImplementation.link(structs, structs.address);
    const mock = await MockContributorImplementation.new();

    let failed = false;
    try {
      await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
        value: 0,
        from: accounts[1],
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      failed = true;
    }

    assert.ok(failed);

    // confirm that the implementation address changed
    let before = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(before.toLowerCase(), ContributorImplementation.address.toLowerCase());

    const upgradeTx = await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    let after = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(after.toLowerCase(), mock.address.toLowerCase());

    // confirm that the ContractUpgraded event is emitted
    let eventOutput = upgradeTx["events"]["ContractUpgraded"]["returnValues"];

    assert.equal(eventOutput["oldContract"].toLowerCase(), before.toLowerCase());
    assert.equal(eventOutput["newContract"].toLowerCase(), after.toLowerCase());

    const mockImpl = new web3.eth.Contract(MockContributorImplementation.abi, TokenSaleContributor.address);

    let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();

    assert.ok(isUpgraded);
  });

  it("conductor and contributor should allow the owner to update consistencyLevel", async function() {
    // test variables
    const initializedConsistencyLevel = config.consistencyLevel;
    const updatedConsistencyLevel = "1";

    const contributorContract = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);
    const conductorContract = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // update the consistency level
    const contributorTx = await contributorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, updatedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    const conductorTx = await conductorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, updatedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    // check getters after the action
    const contributorConsistencyLevelAfter = await contributorContract.methods.consistencyLevel().call();
    const conductorConsistencyLevelAfter = await conductorContract.methods.consistencyLevel().call();

    assert.equal(contributorConsistencyLevelAfter, updatedConsistencyLevel);
    assert.equal(conductorConsistencyLevelAfter, updatedConsistencyLevel);

    // confirm that the ConsistencyLevelUpdate event is emitted for contributor
    let contributorEventOutput = contributorTx["events"]["ConsistencyLevelUpdated"]["returnValues"];

    assert.equal(contributorEventOutput["oldLevel"], initializedConsistencyLevel);
    assert.equal(contributorEventOutput["newLevel"], updatedConsistencyLevel);

    // confirm that the ConsistencyLevelUpdate event is emitted for conductor
    let conductorEventOutput = conductorTx["events"]["ConsistencyLevelUpdated"]["returnValues"];

    assert.equal(conductorEventOutput["oldLevel"], initializedConsistencyLevel);
    assert.equal(conductorEventOutput["newLevel"], updatedConsistencyLevel);

    // revert consistencyLevel back to initialized value
    // update the consistency level
    await contributorContract.methods.updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel).send({
      value: "0",
      from: accounts[0], // contract owner
      gasLimit: GAS_LIMIT,
    });

    await conductorContract.methods.updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel).send({
      value: "0",
      from: accounts[0], // contract owner
      gasLimit: GAS_LIMIT,
    });

    // make sure only the Contributor owner can change consistencyLevel
    let contributorFailed = false;
    try {
      await contributorContract.methods.updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel).send({
        value: "0",
        from: accounts[1], // different account
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      contributorFailed = true;
    }

    // make sure only the Conductor owner can change consistencyLevel
    conductorFailed = false;
    try {
      await conductorContract.methods.updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel).send({
        value: "0",
        from: accounts[1], // different account
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      conductorFailed = true;
    }

    assert.ok(contributorFailed);
    assert.ok(conductorFailed);
  });

  it("conductor should allow the owner to transfer ownership", async function() {
    // test variables
    const currentOwner = accounts[0];
    const newOwner = accounts[1];

    const conductorContract = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    await conductorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, newOwner).send({
      value: "0",
      from: currentOwner, // contract owner
      gasLimit: GAS_LIMIT,
    });

    const conductorTx = await conductorContract.methods.confirmOwnershipTransferRequest().send({
      value: "0",
      from: newOwner, // pending owner
      gasLimit: GAS_LIMIT,
    });

    // check getters after the action
    let conductorOwner = await conductorContract.methods.owner().call();

    assert.equal(conductorOwner, newOwner);

    // confirm that the OwnershipTransfered event is emitted for conductor
    let conductorEventOutput = conductorTx["events"]["OwnershipTransfered"]["returnValues"];

    assert.equal(conductorEventOutput["oldOwner"].toLowerCase(), currentOwner.toLowerCase());
    assert.equal(conductorEventOutput["newOwner"].toLowerCase(), newOwner.toLowerCase());

    // try to submit an ownership transfer request w/ non-owner wallet
    conductorFailed = false;
    try {
      await conductorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, currentOwner).send({
        value: "0",
        from: currentOwner, // no longer the current owner
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      conductorFailed = true;
    }

    assert.ok(conductorFailed);

    // try to confirm the ownership change with the wrong wallet
    conductorFailed = false;
    try {
      await conductorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, newOwner).send({
        value: "0",
        from: newOwner, // contract owner
        gasLimit: GAS_LIMIT,
      });

      await conductorContract.methods.confirmOwnershipTransferRequest().send({
        value: "0",
        from: currentOwner, // pending owner
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller must be pendingOwner"
      );
      conductorFailed = true;
    }

    assert.ok(conductorFailed);

    // transfer ownership back to original owner
    await conductorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, currentOwner).send({
      value: "0",
      from: newOwner, // contract owner
      gasLimit: GAS_LIMIT,
    });

    await conductorContract.methods.confirmOwnershipTransferRequest().send({
      value: "0",
      from: currentOwner, // pending owner
      gasLimit: GAS_LIMIT,
    });

    // check getters after the action
    conductorOwner = await conductorContract.methods.owner().call();

    assert.equal(conductorOwner, currentOwner);

    // confirm that the pending owner address was reset
    const pendingOwner = await conductorContract.methods.pendingOwner().call();

    assert.equal(pendingOwner, ZERO_ADDRESS);
  });

  it("contributor should allow the owner to transfer ownership", async function() {
    // test variables
    const currentOwner = accounts[0];
    const newOwner = accounts[1];

    const contributorContract = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    await contributorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, newOwner).send({
      value: "0",
      from: currentOwner, // contract owner
      gasLimit: GAS_LIMIT,
    });

    const contributorTx = await contributorContract.methods.confirmOwnershipTransferRequest().send({
      value: "0",
      from: newOwner, // pending owner
      gasLimit: GAS_LIMIT,
    });

    // check getters after the action
    let contributorOwner = await contributorContract.methods.owner().call();

    assert.equal(contributorOwner, newOwner);

    // confirm that the OwnershipTransfered event is emitted for contributor
    let contributorEventOutput = contributorTx["events"]["OwnershipTransfered"]["returnValues"];

    assert.equal(contributorEventOutput["oldOwner"].toLowerCase(), currentOwner.toLowerCase());
    assert.equal(contributorEventOutput["newOwner"].toLowerCase(), newOwner.toLowerCase());

    // try to submit an ownership transfer request w/ non-owner wallet
    contributorFailed = false;
    try {
      await contributorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, currentOwner).send({
        value: "0",
        from: currentOwner, // no longer the current owner
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller is not the owner"
      );
      contributorFailed = true;
    }

    assert.ok(contributorFailed);

    // try to confirm the ownership change with the wrong wallet
    contributorFailed = false;
    try {
      await contributorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, newOwner).send({
        value: "0",
        from: newOwner, // contract owner
        gasLimit: GAS_LIMIT,
      });

      await contributorContract.methods.confirmOwnershipTransferRequest().send({
        value: "0",
        from: currentOwner, // pending owner
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert caller must be pendingOwner"
      );
      contributorFailed = true;
    }

    assert.ok(contributorFailed);

    // transfer ownership back to original owner
    await contributorContract.methods.submitOwnershipTransferRequest(TEST_CHAIN_ID, currentOwner).send({
      value: "0",
      from: newOwner, // contract owner
      gasLimit: GAS_LIMIT,
    });

    await contributorContract.methods.confirmOwnershipTransferRequest().send({
      value: "0",
      from: currentOwner, // pending owner
      gasLimit: GAS_LIMIT,
    });

    // check getters after the action
    contributorOwner = await contributorContract.methods.owner().call();

    assert.equal(contributorOwner, currentOwner);

    // confirm that the pending owner address was reset
    const pendingOwner = await contributorContract.methods.pendingOwner().call();

    assert.equal(pendingOwner, ZERO_ADDRESS);
  });

  // global sale test variables
  let SOLD_TOKEN;
  let SOLD_TOKEN_BYTES32_ADDRESS;
  let CONTRIBUTED_TOKEN_ONE;
  let CONTRIBUTED_TOKEN_TWO;
  let SOLD_TOKEN_DECIMALS;
  let SALE_START;
  let SALE_END;
  let SALE_INIT_PAYLOAD;
  let SALE_ID = 0;
  let TOKEN_ONE_INDEX = 0;
  let TOKEN_TWO_INDEX = 1;
  const SELLER = accounts[0];
  const BUYER_ONE = accounts[1];
  const BUYER_TWO = accounts[2];

  it("mint one token to sell, two to buy", async function() {
    // test variables
    const tokenDecimals = 18;
    const mintAccount = accounts[0];
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test

    // token amounts to mint
    const saleTokenMintAmount = "2000";
    const contributedTokensMintAmount = "20000";
    const extraContributedTokensToMint = "5000";

    // token to sell in ICCO
    SOLD_TOKEN = await TokenImplementation.new();
    SOLD_TOKEN_DECIMALS = tokenDecimals;
    SOLD_TOKEN_BYTES32_ADDRESS = "0x000000000000000000000000" + SOLD_TOKEN.address.substr(2);
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";

    await SOLD_TOKEN.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await SOLD_TOKEN.mint(SELLER, saleTokenMintAmount);

    // first token to contribute in sale
    CONTRIBUTED_TOKEN_ONE = await TokenImplementation.new();
    const tokenOneName = "Contributed Stablecoin";
    const tokenOneSymbol = "STABLE";

    await CONTRIBUTED_TOKEN_ONE.initialize(
      tokenOneName,
      tokenOneSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await CONTRIBUTED_TOKEN_ONE.mint(BUYER_ONE, contributedTokensMintAmount);

    // second token to contribute to sale
    CONTRIBUTED_TOKEN_TWO = await TokenImplementation.new();
    const tokenTwoName = "Contributed Coin";
    const tokenTwoSymbol = "COIN";

    await CONTRIBUTED_TOKEN_TWO.initialize(
      tokenTwoName,
      tokenTwoSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await CONTRIBUTED_TOKEN_TWO.mint(BUYER_TWO, contributedTokensMintAmount);

    // mint extra token two to buyer1 for multi-asset contribution test
    await CONTRIBUTED_TOKEN_TWO.mint(BUYER_ONE, extraContributedTokensToMint);
  });

  it("create a sale correctly and attest over wormhole", async function() {
    console.log("\n       -------------------------- Sale Test #1 (Successful) --------------------------");

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_START = current_block.timestamp + 5;
    SALE_END = SALE_START + 8;

    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const acceptedTokenLength = 2;
    const payloadIdType1 = "01";
    const solanaChainId = "1";
    const numAcceptedSolanaTokens = "0";
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_START,
      SALE_END,
      SALE_END, // unlock timestamp
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create the sale
    const createSaleTx = await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventCreateSale event was emitted
    let eventCreateSale = createSaleTx["events"]["EventCreateSale"]["returnValues"];
    assert.equal(eventCreateSale["saleId"], SALE_ID);
    assert.equal(eventCreateSale["creatorAddress"], SELLER);

    // verify contributorWallets getter
    const solanaWallet = await initialized.methods.contributorWallets(SALE_ID, solanaChainId).call();

    assert.equal(
      solanaWallet,
      web3.eth.abi.encodeParameter("address", "0x" + SOLD_TOKEN_BYTES32_ADDRESS.substring(26))
    );

    // verify payload sent to contributor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify payload
    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType1);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
    index += 64;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // token decimals
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLD_TOKEN_DECIMALS);
    index += 2;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_END);
    index += 64;

    // accepted tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenOneConversionRate));
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenTwoConversionRate));
    index += 32;

    // recipient of proceeds
    assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    index += 64;

    // KYC authority public key
    assert.equal(log.payload.substr(index, 40), web3.eth.abi.encodeParameter("address", KYC_AUTHORITY).substring(26));
    index += 40;

    // unlock timestamp
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_END);
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_INIT_PAYLOAD = log.payload.toString();

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_ID + 1);

    // confirm that the localTokenAddress was saved correctly
    const sale = await initialized.methods.sales(SALE_ID).call();

    assert.equal(SOLD_TOKEN.address, sale.localTokenAddress);

    // confirm that we are not accepting any solana tokens
    assert.equal(sale.solanaAcceptedTokensCount, numAcceptedSolanaTokens);
  });

  let INIT_SALE_VM;

  it("should init a sale in the contributor", async function() {
    // test variables
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // create initSale VM
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_INIT_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    let initTx = await initialized.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    INIT_SALE_VM = vm;

    // confirm that the EventSaleInit event was emitted
    let eventOutput = initTx["events"]["EventSaleInit"]["returnValues"];
    assert.equal(eventOutput["saleId"], SALE_ID);

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_ID).call();

    assert.equal(sale.saleID, SALE_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.saleStart, SALE_START);
    assert.equal(sale.saleEnd, SALE_END);
    assert.equal(sale.unlockTimestamp, SALE_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], parseInt(tokenOneConversionRate));
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], parseInt(tokenTwoConversionRate));
    assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    assert.equal(sale.authority.substring(2), KYC_AUTHORITY.substring(2));
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_ID, TOKEN_ONE_INDEX).call();
    const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_ID, TOKEN_TWO_INDEX).call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, parseInt(tokenOneConversionRate));
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, parseInt(tokenTwoConversionRate));

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_ID).call();

    assert.equal(saleTimeframe.start, SALE_START);
    assert.equal(saleTimeframe.end, SALE_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods.getSaleStatus(SALE_ID).call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("sale should only be initialized once in the contributor", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      await initialized.methods.initSale("0x" + INIT_SALE_VM).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale already initiated"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("should accept contributions in the contributor during the sale timeframe", async function() {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["5000", "5000"];
    const tokenTwoContributionAmount = ["5000", "2500"];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[0], {
      from: BUYER_TWO,
    });
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[1], {
      from: BUYER_ONE,
    });

    // perform "kyc" and contribute to the token sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[0],
      BUYER_ONE,
      kycSignerPK
    );
    let contributeTx1 = await initialized.methods
      .contribute(SALE_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[0]), kycSig1)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig2 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[1]), kycSig2)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig3 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[1]), kycSig3)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    // perform "kyc" and contribute tokens to the sale for BUYER_TWO
    const kycSig4 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[0],
      BUYER_TWO,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[0]), kycSig4)
      .send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });

    // confirm that the EventContribute event was emitted
    let eventOutput1 = contributeTx1["events"]["EventContribute"]["returnValues"];
    assert.equal(eventOutput1["saleId"], SALE_ID);
    assert.equal(eventOutput1["tokenIndex"], TOKEN_ONE_INDEX);
    assert.equal(eventOutput1["amount"], parseInt(tokenOneContributionAmount[0]));

    // verify getSaleTotalContribution after contributing
    const totalContributionsTokenOne = await initialized.methods
      .getSaleTotalContribution(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const totalContributionsTokenTwo = await initialized.methods
      .getSaleTotalContribution(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      totalContributionsTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) + parseInt(tokenTwoContributionAmount[1])
    );

    // verify getSaleContribution
    const buyerOneContributionTokenOne = await initialized.methods
      .getSaleContribution(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerOneContributionTokenTwo = await initialized.methods
      .getSaleContribution(SALE_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const buyerTwoContribution = await initialized.methods
      .getSaleContribution(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.equal(
      buyerOneContributionTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(buyerOneContributionTokenTwo, parseInt(tokenTwoContributionAmount[1]));
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  it("should not accept contributions without proper KYC signature", async function() {
    // test variables
    const tokenOneContributionAmount = "10000";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
      from: BUYER_ONE,
    });

    let failed = false;
    try {
      // perform "kyc" and contribute to the token sale
      const kycSig1 = await signContribution(
        CONDUCTOR_BYTES32_ADDRESS,
        SALE_ID,
        TOKEN_ONE_INDEX,
        tokenOneContributionAmount,
        BUYER_ONE,
        accounts[0]
      );
      await initialized.methods
        .contribute(SALE_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount), kycSig1)
        .send({
          from: BUYER_ONE,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert unauthorized contributor"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("should not accept contributions in the contributor for non-existent saleIDs", async function() {
    // test variables
    const tokenOneContributionAmount = "10000";
    const incorrect_sale_id = "42069";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      const kycSig1 = await signContribution(
        CONDUCTOR_BYTES32_ADDRESS,
        SALE_ID,
        TOKEN_ONE_INDEX,
        tokenOneContributionAmount,
        BUYER_TWO,
        kycSignerPK
      );
      await initialized.methods
        .contribute(incorrect_sale_id, TOKEN_ONE_INDEX, tokenOneContributionAmount, kycSig1)
        .send({
          from: BUYER_TWO,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale not initiated");
      failed = true;
    }

    assert.ok(failed);
  });

  it("should not accept contributions after the sale has ended", async function() {
    await wait(10);

    // test variables
    const tokenTwoContributionAmount = "5000";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      const kycSig1 = await signContribution(
        CONDUCTOR_BYTES32_ADDRESS,
        SALE_ID,
        TOKEN_TWO_INDEX,
        tokenTwoContributionAmount,
        BUYER_TWO,
        kycSignerPK
      );
      await initialized.methods.contribute(SALE_ID, TOKEN_TWO_INDEX, tokenTwoContributionAmount, kycSig1).send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale has ended");
      failed = true;
    }

    assert.ok(failed);
  });

  let CONTRIBUTIONS_PAYLOAD;

  it("should attest contributions correctly", async function() {
    // test variables
    const tokenOneContributionAmount = "10000";
    const tokenTwoContributionAmount = "7500";
    const acceptedTokenLength = 2;
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // attest contributions
    const attestTx = await initialized.methods.attestContributions(SALE_ID).send({
      from: BUYER_ONE,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventAttestContribution event was emitted
    let eventOutput = attestTx["events"]["EventAttestContribution"]["returnValues"];
    assert.equal(eventOutput["saleId"], SALE_ID);

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    assert.equal(log.sender, TokenSaleContributor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType2);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
    index += 64;

    // chain id
    assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4));
    index += 4;

    // tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", TOKEN_ONE_INDEX).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenOneContributionAmount);
    index += 64;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", TOKEN_TWO_INDEX).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenTwoContributionAmount);
    index += 64;

    assert.equal(log.payload.length, index);
    CONTRIBUTIONS_PAYLOAD = log.payload.toString();
  });

  it("conductor should collect contributions correctly", async function() {
    // test variables
    const tokenOneContributionAmount = "10000";
    const tokenTwoContributionAmount = "7500";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // verify saleContributionIsCollected getter before collecting contributions
    const isContributionOneCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(!isContributionOneCollectedBefore);
    assert.ok(!isContributionTwoCollectedBefore);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      CONTRIBUTIONS_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    await initialized.methods.collectContribution("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify saleContributionIsCollected getter after collecting contributions
    const isContributionOneCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(isContributionOneCollectedAfter);
    assert.ok(isContributionTwoCollectedAfter);

    // verify saleContributions getter
    const contributions = await initialized.methods.saleContributions(SALE_ID).call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  it("conductor should not collect contributions more than once", async function() {
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      CONTRIBUTIONS_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    let failed = false;
    try {
      // try to collect contributions again
      await initialized.methods.collectContribution("0x" + vm).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert already collected contribution"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  let SALE_SEALED_PAYLOAD;

  it("conductor should not seal a sale for a non-existent saleID", async function() {
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    let failed = false;
    try {
      // try to seal a non-existent sale
      await initialized.methods.sealSale(SALE_ID + 10).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale not initiated");
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should seal the sale correctly and distribute tokens", async function() {
    // test variables
    const expectedContributorBalanceBefore = "0";
    const expectedConductorBalanceBefore = "1000";
    const expectedContributorBalanceAfter = "1000";
    const expectedConductorBalanceAfter = "0";
    const payloadIdType3 = "03";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // balance check before sealing the sale
    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

    assert.equal(actualContributorBalanceBefore, expectedContributorBalanceBefore);
    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

    // verify sealSealed flag in sales
    const saleBefore = await initialized.methods.sales(SALE_ID).call();

    assert.ok(!saleBefore.isSealed);

    // seal the sale
    const sealSaleTx = await initialized.methods.sealSale(SALE_ID).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventSealSale event was emitted
    let eventSeal = sealSaleTx["events"]["EventSealSale"]["returnValues"];
    assert.equal(eventSeal["saleId"], SALE_ID);

    // balance check after sealing the sale
    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

    assert.equal(actualContributorBalanceAfter, expectedContributorBalanceAfter);
    assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify saleSealed payload
    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType3);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
    index += 64;

    SALE_SEALED_PAYLOAD = log.payload;

    // verify saleSealed flag after sealing the sale
    const saleAfter = await initialized.methods.sales(SALE_ID).call();

    assert.ok(saleAfter.isSealed);
  });

  it("contributor should seal a sale correctly", async function() {
    // test variables
    const expectedAllocationTokenOne = "400";
    const expectedAllocationTokenTwo = "600";
    const expectedExcessTokenOne = "0";
    const expectedExcessTokenTwo = "0";
    const expectedRecipientTokenOneBalanceChange = "10000";
    const expectedRecipientTokenTwoBalanceChange = "7500";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // grab contributed token balance before for sale recipient
    const receipientTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    // verify sealSealed getters before calling saleSealed
    const saleBefore = await initialized.methods.sales(SALE_ID).call();

    // verify isSealed flag before
    assert.ok(!saleBefore.isSealed);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_SEALED_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    // seal the sale
    const saleSealedTx = await initialized.methods.saleSealed("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventSealSale event was emitted
    let eventSeal = saleSealedTx["events"]["EventSaleSealed"]["returnValues"];
    assert.equal(eventSeal["saleId"], SALE_ID);

    // confirm that the sale was sealed
    const saleAfter = await initialized.methods.sales(SALE_ID).call();

    assert.ok(saleAfter.isSealed);

    // verify getSaleAllocation after sealing the sale
    const actualAllocationTokenOne = await initialized.methods.getSaleAllocation(SALE_ID, TOKEN_ONE_INDEX).call();
    const actualAllocationTokenTwo = await initialized.methods.getSaleAllocation(SALE_ID, TOKEN_TWO_INDEX).call();

    assert.equal(actualAllocationTokenOne, expectedAllocationTokenOne);
    assert.equal(actualAllocationTokenTwo, expectedAllocationTokenTwo);

    // verify getSaleAllocation after sealing the sale
    const actualExcessTokenOne = await initialized.methods.getSaleExcessContribution(SALE_ID, TOKEN_ONE_INDEX).call();
    const actualExcessTokenTwo = await initialized.methods.getSaleExcessContribution(SALE_ID, TOKEN_TWO_INDEX).call();

    assert.equal(actualExcessTokenOne, expectedExcessTokenOne);
    assert.equal(actualExcessTokenTwo, expectedExcessTokenTwo);

    // confirm that the sale recipient recieved the correct amount of contributions
    const receipientTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    assert.equal(
      receipientTokenOneBalanceAfter - receipientTokenOneBalanceBefore,
      expectedRecipientTokenOneBalanceChange
    );
    assert.equal(
      receipientTokenTwoBalanceAfter - receipientTokenTwoBalanceBefore,
      expectedRecipientTokenTwoBalanceChange
    );
  });

  let ONE_CLAIM_SNAPSHOT;

  it("contributor should distribute tokens correctly", async function() {
    // test variables
    const expectedContributorBalanceBefore = "1000";
    const expectedBuyerOneBalanceBefore = "0";
    const expectedBuyerTwoBalanceBefore = "0";
    const expectedContributorBalanceAfter = "0";
    const expectedBuyerOneBalanceAfter = "600";
    const expectedBuyerTwoBalanceAfter = "400";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // check balances before claiming allocations
    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(actualContributorBalanceBefore, expectedContributorBalanceBefore);
    assert.equal(actualBuyerOneBalanceBefore, expectedBuyerOneBalanceBefore);
    assert.equal(actualBuyerTwoBalanceBefore, expectedBuyerTwoBalanceBefore);

    // verify allocationIsClaimed before claiming allocation
    const isAllocationClaimedBuyerOneTokenOneBefore = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerOneTokenTwoBefore = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedTokenTwoBefore = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(!isAllocationClaimedBuyerOneTokenOneBefore);
    assert.ok(!isAllocationClaimedBuyerOneTokenTwoBefore);
    assert.ok(!isAllocationClaimedTokenTwoBefore);

    // claim allocations for both tokens
    const claimTx1 = await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventClaimAllocation event was emitted
    let eventClaim = claimTx1["events"]["EventClaimAllocation"]["returnValues"];
    assert.equal(eventClaim["saleId"], SALE_ID);
    assert.equal(eventClaim["tokenIndex"], TOKEN_TWO_INDEX);
    assert.equal(eventClaim["amount"], expectedBuyerTwoBalanceAfter);

    ONE_CLAIM_SNAPSHOT = await snapshot();

    await initialized.methods.claimAllocation(SALE_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // check balances after claiming allocations
    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(actualContributorBalanceAfter, expectedContributorBalanceAfter);
    assert.equal(actualBuyerOneBalanceAfter, expectedBuyerOneBalanceAfter);
    assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

    // verify allocationIsClaimed after claiming allocation
    const isAllocationClaimedBuyerOneTokenOneAfter = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerOneTokenTwoAfter = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedTokenTwoAfter = await initialized.methods
      .allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(isAllocationClaimedBuyerOneTokenOneAfter);
    assert.ok(isAllocationClaimedBuyerOneTokenTwoAfter);
    assert.ok(isAllocationClaimedTokenTwoAfter);
  });

  it("allocation should only be claimable once", async function() {
    // revert first allocation claim
    await revert(ONE_CLAIM_SNAPSHOT);

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert allocation already claimed"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("excess contribution should not be claimable when maxRaise is not exceeded", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      await initialized.methods.claimExcessContribution(SALE_ID, TOKEN_ONE_INDEX).send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert no excess contributions for this token"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  let SALE_2_START;
  let SALE_2_END;
  let SALE_2_INIT_PAYLOAD;
  let SALE_2_ID;
  const SALE_2_REFUND_RECIPIENT = accounts[5];

  it("create a second sale correctly and attest over wormhole", async function() {
    console.log(
      "\n       -------------------------- Sale Test #2 (Undersubscribed & Aborted) --------------------------"
    );

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_2_START = current_block.timestamp + 5;
    SALE_2_END = SALE_2_START + 8;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = SALE_2_REFUND_RECIPIENT;
    const acceptedTokenLength = 2;
    const payloadIdType1 = "01";
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_2_START,
      SALE_2_END,
      SALE_2_END, // unlock timestamp
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create a second sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType1);
    index += 2;

    // sale id, should == 1 since it's the second sale
    SALE_2_ID = 1;
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_ID);
    index += 64;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // token decimals
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLD_TOKEN_DECIMALS);
    index += 2;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_END);
    index += 64;

    // accepted tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenOneConversionRate));
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenTwoConversionRate));
    index += 32;

    // recipient of proceeds
    assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    index += 64;

    // KYC authority public key
    assert.equal(log.payload.substr(index, 40), web3.eth.abi.encodeParameter("address", KYC_AUTHORITY).substring(26));
    index += 40;

    // unlock timestamp
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_END);
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_2_INIT_PAYLOAD = log.payload.toString();

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_2_ID + 1);

    // confirm that the localTokenAddress was saved correctl
    const sale = await initialized.methods.sales(SALE_2_ID).call();

    assert.equal(SOLD_TOKEN.address, sale.localTokenAddress);
  });

  it("should init a second sale in the contributor", async function() {
    // test variables
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_2_INIT_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    // initialize the second sale
    await initialized.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_2_ID).call();

    assert.equal(sale.saleID, SALE_2_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.saleStart, SALE_2_START);
    assert.equal(sale.saleEnd, SALE_2_END);
    assert.equal(sale.unlockTimestamp, SALE_2_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], tokenOneConversionRate);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], tokenTwoConversionRate);
    assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    assert.equal(sale.authority.substring(2), KYC_AUTHORITY.substring(2));
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_ONE_INDEX).call();
    const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_TWO_INDEX).call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_2_ID).call();

    assert.equal(saleTimeframe.start, SALE_2_START);
    assert.equal(saleTimeframe.end, SALE_2_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_2_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods.getSaleStatus(SALE_2_ID).call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("should accept contributions in the contributor during the second sale timeframe", async function() {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["500", "500"];
    const tokenTwoContributionAmount = ["100", "100"];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[0], {
      from: BUYER_TWO,
    });
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[1], {
      from: BUYER_ONE,
    });

    // perform "kyc" and contribute tokens to the sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_2_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[0],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_2_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[0]), kycSig1)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig2 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_2_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_2_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[1]), kycSig2)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig3 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_2_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_2_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[1]), kycSig3)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    // perform "kyc" and contribute tokens to the sale for BUYER_TWO
    const kycSig4 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_2_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[0],
      BUYER_TWO,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_2_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[0]), kycSig4)
      .send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });

    // verify getSaleTotalContribution after contributing
    const totalContributionsTokenOne = await initialized.methods
      .getSaleTotalContribution(SALE_2_ID, TOKEN_ONE_INDEX)
      .call();
    const totalContributionsTokenTwo = await initialized.methods
      .getSaleTotalContribution(SALE_2_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      totalContributionsTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) + parseInt(tokenTwoContributionAmount[1])
    );

    // verify getSaleContribution
    const buyerOneContributionTokenOne = await initialized.methods
      .getSaleContribution(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerOneContributionTokenTwo = await initialized.methods
      .getSaleContribution(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const buyerTwoContribution = await initialized.methods
      .getSaleContribution(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.equal(
      buyerOneContributionTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(buyerOneContributionTokenTwo, parseInt(tokenTwoContributionAmount[1]));
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  let CONTRIBUTIONS_PAYLOAD_2;

  it("should attest contributions for second sale correctly", async function() {
    await wait(10);

    // test variables
    const tokenOneContributionAmount = 1000;
    const tokenTwoContributionAmount = 200;
    const acceptedTokenLength = 2;
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // attest contributions
    await initialized.methods.attestContributions(SALE_2_ID).send({
      from: BUYER_ONE,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    assert.equal(log.sender, TokenSaleContributor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType2);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_ID);
    index += 64;

    // chain id
    assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4));
    index += 4;

    // tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token index
    assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2));
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenOneContributionAmount);
    index += 64;

    // token index
    assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2));
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenTwoContributionAmount);
    index += 64;

    assert.equal(log.payload.length, index);

    CONTRIBUTIONS_PAYLOAD_2 = log.payload.toString();
  });

  it("conductor should collect second sale contributions correctly", async function() {
    // test variables
    const tokenOneContributionAmount = "1000";
    const tokenTwoContributionAmount = "200";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // verify saleContributionIsCollected getter before calling contribute
    const isContributionOneCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_2_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_2_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(!isContributionOneCollectedBefore);
    assert.ok(!isContributionTwoCollectedBefore);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      CONTRIBUTIONS_PAYLOAD_2,
      [testSigner1PK],
      0,
      0
    );

    // collect the contributions
    await initialized.methods.collectContribution("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify saleContributionIsCollected getter after calling contribute
    const isContributionOneCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_2_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_2_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(isContributionOneCollectedAfter);
    assert.ok(isContributionTwoCollectedAfter);

    // verify saleContributions getter
    const contributions = await initialized.methods.saleContributions(SALE_2_ID).call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  let SALE_SEALED_PAYLOAD_2;

  it("conductor should abort the second sale and refund sale tokens correctly", async function() {
    // test variables
    const expectedContributorBalance = "600";
    const expectedConductorBalanceBefore = "1000";
    const expectedConductorBalanceAfter = "0";
    const expectedRefundRecipientBalanceChange = "1000";
    const payloadIdType4 = "04";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
    const refundRecipientBalanceBefore = await SOLD_TOKEN.balanceOf(SALE_2_REFUND_RECIPIENT);

    // confirm that the sale is not aborted yet
    const saleBefore = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(!saleBefore.isAborted);

    // contributor balance is 500 before because of the reverted transaction
    // in "allocation should only be claimable once"
    assert.equal(actualContributorBalanceBefore, expectedContributorBalance);
    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

    const sealAbortTx = await initialized.methods.sealSale(SALE_2_ID).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventAbortSale event was emitted
    const eventSealAbort = sealAbortTx["events"]["EventAbortSale"]["returnValues"];
    assert.equal(eventSealAbort["saleId"], SALE_2_ID);

    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
    const refundRecipientBalanceAfter = await SOLD_TOKEN.balanceOf(SALE_2_REFUND_RECIPIENT);

    // check balances after sealing the sale
    assert.equal(actualContributorBalanceAfter, expectedContributorBalance);
    assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);
    assert.equal(
      parseInt(refundRecipientBalanceAfter) - parseInt(refundRecipientBalanceBefore),
      expectedRefundRecipientBalanceChange
    );

    // confirm that the sale is aborted
    const saleAfter = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(saleAfter.isAborted);

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify sale sealed payload
    SALE_SEALED_PAYLOAD_2 = log.payload;

    // payload id
    let index = 2;
    assert.equal(SALE_SEALED_PAYLOAD_2.substr(index, 2), payloadIdType4);
    index += 2;

    // sale id
    assert.equal(parseInt(SALE_SEALED_PAYLOAD_2.substr(index, 64), 16), SALE_2_ID);
    index += 64;

    // send refunded tokens back to SELLER account
    await SOLD_TOKEN.approve(SELLER, expectedRefundRecipientBalanceChange, {
      from: SALE_2_REFUND_RECIPIENT,
    });
    await SOLD_TOKEN.transferFrom(SALE_2_REFUND_RECIPIENT, SELLER, expectedRefundRecipientBalanceChange);
  });

  it("contributor should abort second sale correctly", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // verify getSaleStatus before aborting in contributor
    const statusBefore = await initialized.methods.getSaleStatus(SALE_2_ID).call();

    assert.ok(!statusBefore.isAborted);
    assert.ok(!statusBefore.isSealed);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_SEALED_PAYLOAD_2,
      [testSigner1PK],
      0,
      0
    );

    // abort the sale
    await initialized.methods.saleAborted("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that saleAborted was set to true
    const statusAfter = await initialized.methods.getSaleStatus(SALE_2_ID).call();

    assert.ok(statusAfter.isAborted);
    assert.ok(!statusAfter.isSealed);
  });

  let ONE_REFUND_SNAPSHOT;

  it("contributor should distribute refunds to contributors correctly", async function() {
    // test variables
    const expectedContributorTokenOneBalanceBefore = "1000";
    const expectedContributorTokenTwoBalanceBefore = "200";
    const expectedContributorTokenOneBalanceAfter = "0";
    const expectedContributorTokenTwoBalanceAfter = "0";
    const expectedBuyerOneTokenOneBalanceBefore = "9000";
    const expectedBuyerOneTokenTwoBalanceBefore = "2400";
    const expectedBuyerTwoBalanceBefore = "14900";
    const expectedBuyerOneTokenOneBalanceAfter = "10000";
    const expectedBuyerOneTokenTwoBalanceAfter = "2500";
    const expectedBuyerTwoBalanceAfter = "15000";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // confirm refundIsClaimed is set to false
    const buyerOneHasClaimedRefundBefore = await initialized.methods
      .refundIsClaimed(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerTwoHasClaimedRefundBefore = await initialized.methods
      .refundIsClaimed(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(!buyerOneHasClaimedRefundBefore);
    assert.ok(!buyerTwoHasClaimedRefundBefore);

    // check balances of contributed tokens on the contributor
    const actualContributorTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);

    assert.equal(actualContributorTokenOneBalanceBefore, expectedContributorTokenOneBalanceBefore);
    assert.equal(actualContributorTokenTwoBalanceBefore, expectedContributorTokenTwoBalanceBefore);

    // check buyer balances
    const actualBuyerOneTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerOneTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    assert.equal(actualBuyerOneTokenOneBalanceBefore, expectedBuyerOneTokenOneBalanceBefore);
    assert.equal(actualBuyerOneTokenTwoBalanceBefore, expectedBuyerOneTokenTwoBalanceBefore);
    assert.equal(actualBuyerTwoBalanceBefore, expectedBuyerTwoBalanceBefore);

    // BUYER_ONE/BUYER_TWO claims refunds
    const refundTx1 = await initialized.methods.claimRefund(SALE_2_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventClaimRefund event was emitted
    let eventClaim = refundTx1["events"]["EventClaimRefund"]["returnValues"];
    assert.equal(eventClaim["saleId"], SALE_2_ID);
    assert.equal(eventClaim["tokenIndex"], TOKEN_ONE_INDEX);
    assert.equal(
      eventClaim["amount"],
      parseInt(expectedBuyerOneTokenOneBalanceAfter) - parseInt(actualBuyerOneTokenOneBalanceBefore)
    );

    // snapshot to test trying to claim refund 2x
    ONE_REFUND_SNAPSHOT = await snapshot();

    await initialized.methods.claimRefund(SALE_2_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });
    await initialized.methods.claimRefund(SALE_2_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // check balances of contributed tokens on contributor
    const actualContributorTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);

    assert.equal(actualContributorTokenOneBalanceAfter, expectedContributorTokenOneBalanceAfter);
    assert.equal(actualContributorTokenTwoBalanceAfter, expectedContributorTokenTwoBalanceAfter);

    // check buyer balances after claiming refund
    const actualBuyerOneTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerOneTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    assert.equal(actualBuyerOneTokenOneBalanceAfter, expectedBuyerOneTokenOneBalanceAfter);
    assert.equal(actualBuyerOneTokenTwoBalanceAfter, expectedBuyerOneTokenTwoBalanceAfter);
    assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

    // confirm refundIsClaimed is set to true
    const buyerOneHasClaimedRefundAfter = await initialized.methods
      .refundIsClaimed(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerTwoHasClaimedRefundAfter = await initialized.methods
      .refundIsClaimed(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(buyerOneHasClaimedRefundAfter);
    assert.ok(buyerTwoHasClaimedRefundAfter);
  });

  it("refund should only be claimable once in contributor", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // revert the refund so we can try to claim it again
    await revert(ONE_REFUND_SNAPSHOT);

    let failed = false;
    try {
      // attempt to claim refund a second time
      await initialized.methods.claimRefund(SALE_2_ID, TOKEN_ONE_INDEX).send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert refund already claimed"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  let SALE_3_START;
  let SALE_3_END;
  let SALE_3_INIT_PAYLOAD;
  let SALE_3_ID;

  it("create a third sale correctly and attest over wormhole", async function() {
    console.log("\n       -------------------------- Sale Test #3 (Aborted Early) --------------------------");

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_3_START = current_block.timestamp + 5;
    SALE_3_END = SALE_3_START + 8;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const acceptedTokenLength = 2;
    const payloadIdType1 = "01";
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_3_START,
      SALE_3_END,
      SALE_3_END, // unlock timestamp
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create a third sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType1);
    index += 2;

    // sale id, should == 1 since it's the third sale
    SALE_3_ID = SALE_2_ID + 1;
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_ID);
    index += 64;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // token decimals
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLD_TOKEN_DECIMALS);
    index += 2;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_END);
    index += 64;

    // accepted tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenOneConversionRate));
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenTwoConversionRate));
    index += 32;

    // recipient of proceeds
    assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    index += 64;

    // KYC authority public key
    assert.equal(log.payload.substr(index, 40), web3.eth.abi.encodeParameter("address", KYC_AUTHORITY).substring(26));
    index += 40;

    // unlock timestamp
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_END);
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_3_INIT_PAYLOAD = log.payload.toString();

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_3_ID + 1);

    // confirm that the localTokenAddress was saved correctl
    const sale = await initialized.methods.sales(SALE_3_ID).call();

    assert.equal(SOLD_TOKEN.address, sale.localTokenAddress);
  });

  it("should init a third sale in the contributor", async function() {
    // test variables
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_3_INIT_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    // initialize the third sale
    await initialized.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_3_ID).call();

    assert.equal(sale.saleID, SALE_3_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.saleStart, SALE_3_START);
    assert.equal(sale.saleEnd, SALE_3_END);
    assert.equal(sale.unlockTimestamp, SALE_3_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], tokenOneConversionRate);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], tokenTwoConversionRate);
    assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    assert.equal(sale.authority.substring(2), KYC_AUTHORITY.substring(2));
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_ONE_INDEX).call();
    const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_TWO_INDEX).call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_3_ID).call();

    assert.equal(saleTimeframe.start, SALE_3_START);
    assert.equal(saleTimeframe.end, SALE_3_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_3_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods.getSaleStatus(SALE_3_ID).call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  let SALE_SEALED_PAYLOAD_3;

  it("conductor should abort sale before the third sale starts and refund the refundRecipient", async function() {
    // test variables
    const payloadIdType4 = "04";
    const refundRecipient = accounts[0];
    const expectedRefundRecipientBalanceChange = "1000";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // verify getSaleStatus getter before aborting
    const saleStatusBefore = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(!saleStatusBefore.isSealed);
    assert.ok(!saleStatusBefore.isAborted);

    // make sure only the initiator can abort the sale early
    let failed = false;
    try {
      await initialized.methods.abortSaleBeforeStartTime(SALE_3_ID).send({
        from: BUYER_ONE,
        value: WORMHOLE_FEE,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert only initiator can abort the sale early"
      );
      failed = true;
    }

    assert.ok(failed);

    // balance check before aborting the sale
    const refundRecipientBalanceBefore = await SOLD_TOKEN.balanceOf(refundRecipient);

    // abort the sale
    const abortTx = await initialized.methods.abortSaleBeforeStartTime(SALE_3_ID).send({
      from: SELLER, // must be the sale initiator (msg.sender in createSale())
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventAbortSaleBeforeStart event was emitted
    const eventAbort = abortTx["events"]["EventAbortSaleBeforeStart"]["returnValues"];
    assert.equal(eventAbort["saleId"], SALE_3_ID);

    // balance check after aborting the sale
    const refundRecipientBalanceAfter = await SOLD_TOKEN.balanceOf(refundRecipient);

    // confirm that the refundRecipient recieved the sale tokens
    assert.equal(
      parseInt(refundRecipientBalanceAfter) - parseInt(refundRecipientBalanceBefore),
      expectedRefundRecipientBalanceChange
    );

    // verify getSaleStatus getter after aborting
    const saleStatusAfter = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(!saleStatusAfter.isSealed);
    assert.ok(saleStatusAfter.isAborted);

    // grab VAA so contributor can abort the sale
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify sale sealed payload
    SALE_SEALED_PAYLOAD_3 = log.payload;

    // payload id
    let index = 2;
    assert.equal(SALE_SEALED_PAYLOAD_3.substr(index, 2), payloadIdType4);
    index += 2;

    // sale id
    assert.equal(parseInt(SALE_SEALED_PAYLOAD_3.substr(index, 64), 16), SALE_3_ID);
    index += 64;
  });

  it("should accept contributions after sale period starts and before aborting the sale (block timestamps out of sync test)", async function() {
    // this test simulates block timestamps being out of sync cross-chain
    await wait(5);

    // test variables
    const tokenOneContributionAmount = "100";
    const tokenTwoContributionAmount = "50";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
      from: BUYER_ONE,
    });
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount, {
      from: BUYER_TWO,
    });

    // contribute tokens to the sale
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_3_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount,
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_3_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount), kycSig1)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig2 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_3_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount,
      BUYER_TWO,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_3_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount), kycSig2)
      .send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });

    // verify getSaleTotalContribution after contributing
    const totalContributionsTokenOne = await initialized.methods
      .getSaleTotalContribution(SALE_3_ID, TOKEN_ONE_INDEX)
      .call();
    const totalContributionsTokenTwo = await initialized.methods
      .getSaleTotalContribution(SALE_3_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(totalContributionsTokenOne, parseInt(tokenOneContributionAmount));
    assert.equal(totalContributionsTokenTwo, parseInt(tokenTwoContributionAmount));

    // verify getSaleContribution
    const buyerOneContribution = await initialized.methods
      .getSaleContribution(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerTwoContribution = await initialized.methods
      .getSaleContribution(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.equal(buyerOneContribution, parseInt(tokenOneContributionAmount));
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount));
  });

  it("contributor should abort third sale correctly", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // verify getSaleStatus before aborting in contributor
    const statusBefore = await initialized.methods.getSaleStatus(SALE_3_ID).call();

    assert.ok(!statusBefore.isAborted);
    assert.ok(!statusBefore.isSealed);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_SEALED_PAYLOAD_3,
      [testSigner1PK],
      0,
      0
    );

    // abort the sale
    await initialized.methods.saleAborted("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that saleAborted was set to true
    const statusAfter = await initialized.methods.getSaleStatus(SALE_3_ID).call();

    assert.ok(statusAfter.isAborted);
    assert.ok(!statusAfter.isSealed);
  });

  it("contributor should not allow contributions after sale is aborted early", async function() {
    // test variables
    const tokenOneContributionAmount = "100";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
      from: BUYER_ONE,
    });

    let failed = false;
    try {
      // try to contribute tokens to the sale
      const kycSig1 = await signContribution(
        CONDUCTOR_BYTES32_ADDRESS,
        SALE_3_ID,
        TOKEN_ONE_INDEX,
        tokenOneContributionAmount,
        BUYER_ONE,
        kycSignerPK
      );
      await initialized.methods
        .contribute(SALE_3_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount), kycSig1)
        .send({
          from: BUYER_ONE,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale was aborted");
      failed = true;
    }

    assert.ok(failed);
  });

  it("contributor should not allow contributions to be attested after sale is aborted early", async function() {
    await wait(10);

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      // attest contributions
      await initialized.methods.attestContributions(SALE_2_ID).send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert already sealed / aborted"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("contributor should distribute refunds to contributors correctly after sale is aborted early", async function() {
    // test variables
    const expectedContributorTokenOneBalanceBefore = "100"; // 100 contributed
    const expectedContributorTokenTwoBalanceBefore = "250"; // 50 contributed - there is some residual amount from a previous test
    const expectedBuyerOneBalanceBefore = "9900";
    const expectedBuyerTwoBalanceBefore = "14850";
    const expectedContributorTokenOneBalanceAfter = "0";
    const expectedContributorTokenTwoBalanceAfter = "200";
    const expectedBuyerOneBalanceAfter = "10000";
    const expectedBuyerTwoBalanceAfter = "14900";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // confirm refundIsClaimed is set to false
    const buyerOneHasClaimedRefundBefore = await initialized.methods
      .refundIsClaimed(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerTwoHasClaimedRefundBefore = await initialized.methods
      .refundIsClaimed(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(!buyerOneHasClaimedRefundBefore);
    assert.ok(!buyerTwoHasClaimedRefundBefore);

    // check balances of contributed tokens for buyers and the contributor
    const actualContributorTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    assert.equal(actualContributorTokenOneBalanceBefore, expectedContributorTokenOneBalanceBefore);
    assert.equal(actualContributorTokenTwoBalanceBefore, expectedContributorTokenTwoBalanceBefore);
    assert.equal(actualBuyerOneBalanceBefore, expectedBuyerOneBalanceBefore);
    assert.equal(actualBuyerTwoBalanceBefore, expectedBuyerTwoBalanceBefore);

    // BUYER_ONE/BUYER_TWO claims refund
    await initialized.methods.claimRefund(SALE_3_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    await initialized.methods.claimRefund(SALE_3_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // check balances of contributed tokens for buyers and the contributor
    const actualContributorTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    assert.equal(actualContributorTokenOneBalanceAfter, expectedContributorTokenOneBalanceAfter);
    assert.equal(actualContributorTokenTwoBalanceAfter, expectedContributorTokenTwoBalanceAfter);
    assert.equal(actualBuyerOneBalanceAfter, expectedBuyerOneBalanceAfter);
    assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

    // confirm refundIsClaimed is set to true
    const buyerOneHasClaimedRefundAfter = await initialized.methods
      .refundIsClaimed(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerTwoHasClaimedRefundAfter = await initialized.methods
      .refundIsClaimed(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(buyerOneHasClaimedRefundAfter);
    assert.ok(buyerTwoHasClaimedRefundAfter);
  });

  // more global sale test variables
  let SALE_4_START;
  let SALE_4_END;
  let SALE_4_INIT_PAYLOAD;
  let SALE_4_ID;

  it("create a fourth sale correctly and attest over wormhole", async function() {
    console.log(
      "\n       -------------------------- Sale Test #4 (Oversubscribed & Successful) --------------------------"
    );

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_4_START = current_block.timestamp + 5;
    SALE_4_END = SALE_4_START + 8;

    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "6000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "4000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const acceptedTokenLength = 2;
    const payloadIdType1 = "01";
    const saleTokenMintAmount = "2000";
    const isFixedPriceSale = true;

    // mint some more sale tokens
    await SOLD_TOKEN.mint(SELLER, saleTokenMintAmount);
    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale, // set this to true for fun (shouldn't affect the sale outcome)
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_4_START,
      SALE_4_END,
      SALE_4_END, // unlock timestamp
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create the sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // Verify Payload sent to contributor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify payload
    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType1);
    index += 2;

    // sale id
    SALE_4_ID = SALE_3_ID + 1;
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_ID);
    index += 64;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // token decimals
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLD_TOKEN_DECIMALS);
    index += 2;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_END);
    index += 64;

    // accepted tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenOneConversionRate));
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(parseInt(log.payload.substr(index, 32), 16), parseInt(tokenTwoConversionRate));
    index += 32;

    // recipient of proceeds
    assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    index += 64;

    // KYC authority public key
    assert.equal(log.payload.substr(index, 40), web3.eth.abi.encodeParameter("address", KYC_AUTHORITY).substring(26));
    index += 40;

    // unlock timestamp
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_END);
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_4_INIT_PAYLOAD = log.payload.toString();

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_4_ID + 1);

    // confirm that the localTokenAddress was saved correctl
    const sale = await initialized.methods.sales(SALE_4_ID).call();

    assert.equal(SOLD_TOKEN.address, sale.localTokenAddress);
  });

  it("should init a fourth sale in the contributor", async function() {
    // test variables
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "4000000000000000000";
    const saleRecipient = accounts[0];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_4_INIT_PAYLOAD,
      [testSigner1PK],
      0,
      0
    );

    // initialize the fourth sale
    await initialized.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_4_ID).call();

    assert.equal(sale.saleID, SALE_4_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.saleStart, SALE_4_START);
    assert.equal(sale.saleEnd, SALE_4_END);
    assert.equal(sale.unlockTimestamp, SALE_4_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], tokenOneConversionRate);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], tokenTwoConversionRate);
    assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    assert.equal(sale.authority.substring(2), KYC_AUTHORITY.substring(2));
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_4_ID, TOKEN_ONE_INDEX).call();
    const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_4_ID, TOKEN_TWO_INDEX).call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_4_ID).call();

    assert.equal(saleTimeframe.start, SALE_4_START);
    assert.equal(saleTimeframe.end, SALE_4_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_4_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods.getSaleStatus(SALE_4_ID).call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("should accept contributions in the contributor during the fourth sale timeframe", async function() {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["2000", "4000"];
    const tokenTwoContributionAmount = ["500", "500"];

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[0], {
      from: BUYER_TWO,
    });
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount[1], {
      from: BUYER_ONE,
    });

    // perform "kyc" and contribute tokens to the sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_4_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[0],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_4_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[0]), kycSig1)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig2 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_4_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_4_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount[1]), kycSig2)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    const kycSig3 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_4_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[1],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_4_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[1]), kycSig3)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    // perform "kyc" and contribute tokens to the sale for BUYER_TWO
    const kycSig4 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_4_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount[0],
      BUYER_TWO,
      kycSignerPK
    );
    await initialized.methods
      .contribute(SALE_4_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount[0]), kycSig4)
      .send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });

    // verify getSaleTotalContribution after contributing
    const totalContributionsTokenOne = await initialized.methods
      .getSaleTotalContribution(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const totalContributionsTokenTwo = await initialized.methods
      .getSaleTotalContribution(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      totalContributionsTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) + parseInt(tokenTwoContributionAmount[1])
    );

    // verify getSaleContribution
    const buyerOneContributionTokenOne = await initialized.methods
      .getSaleContribution(SALE_4_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const buyerOneContributionTokenTwo = await initialized.methods
      .getSaleContribution(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const buyerTwoContribution = await initialized.methods
      .getSaleContribution(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.equal(
      buyerOneContributionTokenOne,
      parseInt(tokenOneContributionAmount[0]) + parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(buyerOneContributionTokenTwo, parseInt(tokenTwoContributionAmount[1]));
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  let CONTRIBUTIONS_PAYLOAD_4;

  it("should attest contributions for fourth sale correctly", async function() {
    await wait(10);

    // test variables
    const tokenOneContributionAmount = "6000"; // sum of both contributions
    const tokenTwoContributionAmount = "1000";
    const acceptedTokenLength = "2";
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // attest contributions
    await initialized.methods.attestContributions(SALE_4_ID).send({
      from: BUYER_ONE,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    assert.equal(log.sender, TokenSaleContributor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType2);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_ID);
    index += 64;

    // chain id
    assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4));
    index += 4;

    // tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
    index += 2;

    // token index
    assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2));
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenOneContributionAmount);
    index += 64;

    // token index
    assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2));
    index += 2;

    // amount
    assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenTwoContributionAmount);
    index += 64;

    assert.equal(log.payload.length, index);

    CONTRIBUTIONS_PAYLOAD_4 = log.payload.toString();
  });

  it("conductor should collect fourth sale contributions correctly", async function() {
    // test variables
    const tokenOneContributionAmount = "6000"; // both contributions
    const tokenTwoContributionAmount = "1000";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // verify saleContributionIsCollected getter before collecting contributions
    const isContributionOneCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedBefore = await initialized.methods
      .saleContributionIsCollected(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(!isContributionOneCollectedBefore);
    assert.ok(!isContributionTwoCollectedBefore);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      CONTRIBUTIONS_PAYLOAD_4,
      [testSigner1PK],
      0,
      0
    );

    await initialized.methods.collectContribution("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify saleContributionIsCollected getter after collecting contributions
    const isContributionOneCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const isContributionTwoCollectedAfter = await initialized.methods
      .saleContributionIsCollected(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.ok(isContributionOneCollectedAfter);
    assert.ok(isContributionTwoCollectedAfter);

    // verify saleContributions getter
    const contributions = await initialized.methods.saleContributions(SALE_4_ID).call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  let SALE_SEALED_PAYLOAD_4;

  it("conductor should seal the fourth sale correctly and distribute tokens", async function() {
    // test variables
    const expectedContributorBalanceBefore = "600";
    const expectedConductorBalanceBefore = "1000";
    const expectedContributorBalanceAfter = "1600";
    const expectedConductorBalanceAfter = "0";
    const payloadIdType3 = "03";

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

    assert.equal(actualContributorBalanceBefore, expectedContributorBalanceBefore);
    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

    // verify sealSealed flag in sales
    const saleBefore = await initialized.methods.sales(SALE_4_ID).call();

    assert.ok(!saleBefore.isSealed);

    // seal the sale
    const sealSuccessTx = await initialized.methods.sealSale(SALE_4_ID).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventSealSale event was emitted
    const eventSeal = sealSuccessTx["events"]["EventSealSale"]["returnValues"];
    assert.equal(eventSeal["saleId"], SALE_4_ID);

    // balance check
    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

    assert.equal(actualContributorBalanceAfter, expectedContributorBalanceAfter);
    assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify saleSealed payload
    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType3);
    index += 2;

    // sale id
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_ID);
    index += 64;

    SALE_SEALED_PAYLOAD_4 = log.payload;

    // verify saleSealed flag after sealing the sale
    const saleAfter = await initialized.methods.sales(SALE_4_ID).call();

    assert.ok(saleAfter.isSealed);
  });

  it("contributor should seal the fourth sale correctly", async function() {
    // test variables
    const expectedAllocationTokenOne = "600";
    const expectedAllocationTokenTwo = "400";
    const expectedExcessTokenOne = "2400";
    const expectedExcessTokenTwo = "400";
    const expectedRecipientTokenOneBalanceChange = "3600";
    const expectedRecipientTokenTwoBalanceChange = "600";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // grab contributed token balance before for sale recipient
    const receipientTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    // verify sealSealed getters before calling saleSealed
    const saleBefore = await initialized.methods.sales(SALE_4_ID).call();

    // verify isSealed flag before
    assert.ok(!saleBefore.isSealed);

    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      SALE_SEALED_PAYLOAD_4,
      [testSigner1PK],
      0,
      0
    );

    // seal the sale
    await initialized.methods.saleSealed("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the sale was sealed
    const saleAfter = await initialized.methods.sales(SALE_4_ID).call();

    assert.ok(saleAfter.isSealed);

    // verify getSaleAllocation after sealing the sale
    const actualAllocationTokenOne = await initialized.methods.getSaleAllocation(SALE_4_ID, TOKEN_ONE_INDEX).call();
    const actualAllocationTokenTwo = await initialized.methods.getSaleAllocation(SALE_4_ID, TOKEN_TWO_INDEX).call();

    assert.equal(actualAllocationTokenOne, expectedAllocationTokenOne);
    assert.equal(actualAllocationTokenTwo, expectedAllocationTokenTwo);

    // verify getSaleExcessContribution after sealing the sale
    const actualExcessTokenOne = await initialized.methods.getSaleExcessContribution(SALE_4_ID, TOKEN_ONE_INDEX).call();
    const actualExcessTokenTwo = await initialized.methods.getSaleExcessContribution(SALE_4_ID, TOKEN_TWO_INDEX).call();

    assert.equal(actualExcessTokenOne, expectedExcessTokenOne);
    assert.equal(actualExcessTokenTwo, expectedExcessTokenTwo);

    // confirm that the sale recipient recieved the correct amount of contributions
    const receipientTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    assert.equal(
      receipientTokenOneBalanceAfter - receipientTokenOneBalanceBefore,
      expectedRecipientTokenOneBalanceChange
    );
    assert.equal(
      receipientTokenTwoBalanceAfter - receipientTokenTwoBalanceBefore,
      expectedRecipientTokenTwoBalanceChange
    );
  });

  it("contributor should distribute tokens correctly", async function() {
    // test variables
    const expectedContributorSaleTokenBalanceChange = "1000";
    const expectedBuyerOneSaleTokenBalanceChange = "800"; // 80% of total contribution (2000 * 1 + 4000 * 1 + 500 * 4 = 8000)
    const expectedBuyerTwoSaleTokenBalanceChange = "200"; // 20% of total contribution (500 * 4 = 2000)

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // check balances before claiming allocations and excess contributions
    const contributorSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const buyerOneSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const buyerTwoSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    // verify allocationIsClaimed before claiming allocation
    const isAllocationClaimedBuyerOneTokenOneBefore = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerOneTokenTwoBefore = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerTwoBefore = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(!isAllocationClaimedBuyerOneTokenOneBefore);
    assert.ok(!isAllocationClaimedBuyerOneTokenTwoBefore);
    assert.ok(!isAllocationClaimedBuyerTwoBefore);

    // claim allocations for both tokens
    await initialized.methods.claimAllocation(SALE_4_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    await initialized.methods.claimAllocation(SALE_4_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    await initialized.methods.claimAllocation(SALE_4_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // check that sale token allocations were distributed correctly
    const contributorSaleTokenBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
    const buyerOneSaleTokenBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const buyerTwoSaleTokenBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(
      contributorSaleTokenBalanceBefore - contributorSaleTokenBalanceAfter,
      expectedContributorSaleTokenBalanceChange
    );
    assert.equal(
      buyerOneSaleTokenBalanceAfter - buyerOneSaleTokenBalanceBefore,
      expectedBuyerOneSaleTokenBalanceChange
    );
    assert.equal(
      buyerTwoSaleTokenBalanceAfter - buyerTwoSaleTokenBalanceBefore,
      expectedBuyerTwoSaleTokenBalanceChange
    );

    // verify allocationIsClaimed before claiming allocation
    const isAllocationClaimedBuyerOneTokenOneAfter = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerOneTokenTwoAfter = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isAllocationClaimedBuyerTwoAfter = await initialized.methods
      .allocationIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(isAllocationClaimedBuyerOneTokenOneAfter);
    assert.ok(isAllocationClaimedBuyerOneTokenTwoAfter);
    assert.ok(isAllocationClaimedBuyerTwoAfter);
  });

  let ONE_EXCESS_REFUND_SNAPSHOT;

  it("contributor should distribute excess contributions correctly", async function() {
    // expected refunds from excess contributions
    // 10k contributions - 6k maxRaise = 4k in refunds (multiplier applied)
    const expectedBuyerOneTokenOneRefund = "2400"; // .6 * 4k / 1 (multiplier)
    const expectedBuyerOneTokenTwoRefund = "200"; // .2 * 4k / 4 (multiplier)
    const expectedBuyerTwoTokenTwoRefund = "200"; // .2 * 4k / 4 (multiplier)

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // balances of contributed tokens
    const buyerOneTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const buyerOneTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const buyerTwoTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    // verify excessContributionIsClaimed before claiming excessContributions
    const isExcessClaimedBuyerOneTokenOneBefore = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isExcessClaimedBuyerOneTokenTwoBefore = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isExcessClaimedBuyerTwoBefore = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(!isExcessClaimedBuyerOneTokenOneBefore);
    assert.ok(!isExcessClaimedBuyerOneTokenTwoBefore);
    assert.ok(!isExcessClaimedBuyerTwoBefore);

    // claim excess refunds here
    // claim allocations for both tokens
    await initialized.methods.claimExcessContribution(SALE_4_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    ONE_EXCESS_REFUND_SNAPSHOT = await snapshot();

    await initialized.methods.claimExcessContribution(SALE_4_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    const claimExcessTx = await initialized.methods.claimExcessContribution(SALE_4_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the EventClaimExcessContribution event was emitted
    const eventClaimExcess = claimExcessTx["events"]["EventClaimExcessContribution"]["returnValues"];
    assert.equal(eventClaimExcess["saleId"], SALE_4_ID);
    assert.equal(eventClaimExcess["tokenIndex"], TOKEN_TWO_INDEX);
    assert.equal(eventClaimExcess["amount"], expectedBuyerTwoTokenTwoRefund);

    // check that excess contributions were distributed correctly
    const buyerOneTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const buyerOneTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const buyerTwoTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

    assert.equal(buyerOneTokenOneBalanceAfter - buyerOneTokenOneBalanceBefore, expectedBuyerOneTokenOneRefund);
    assert.equal(buyerOneTokenTwoBalanceAfter - buyerOneTokenTwoBalanceBefore, expectedBuyerOneTokenTwoRefund);
    assert.equal(buyerTwoTokenTwoBalanceAfter - buyerTwoTokenTwoBalanceBefore, expectedBuyerTwoTokenTwoRefund);

    // verify excessContributionIsClaimed after claiming excessContributions
    const isExcessClaimedBuyerOneTokenOneAfter = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_ONE_INDEX, BUYER_ONE)
      .call();
    const isExcessClaimedBuyerOneTokenTwoAfter = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_ONE)
      .call();
    const isExcessClaimedBuyerTwoAfter = await initialized.methods
      .excessContributionIsClaimed(SALE_4_ID, TOKEN_TWO_INDEX, BUYER_TWO)
      .call();

    assert.ok(isExcessClaimedBuyerOneTokenOneAfter);
    assert.ok(isExcessClaimedBuyerOneTokenTwoAfter);
    assert.ok(isExcessClaimedBuyerTwoAfter);
  });

  it("excess contribution should only be claimable once", async function() {
    // revert first excessContribution claim
    await revert(ONE_EXCESS_REFUND_SNAPSHOT);

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      await initialized.methods.claimExcessContribution(SALE_4_ID, TOKEN_ONE_INDEX).send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert excess contribution already claimed"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  // more global sale test variables
  let SALE_5_START;
  let SALE_5_END;
  let SALE_5_ID;
  let SOLANA_TOKEN_INDEX_ONE;
  let SOLANA_TOKEN_INDEX_TWO;
  let ETH_TOKEN_INDEX;
  let CONTRIBUTED_TOKEN_THREE;

  it("create a fifth sale correctly and attest over wormhole", async function() {
    console.log("\n       -------------------------- Sale Test #5 (Sale With Solana Token) --------------------------");

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_5_START = current_block.timestamp + 5;
    SALE_5_END = SALE_5_START + 8;

    const saleTokenAmount = "10000000000000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "6000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const payloadIdType5 = "05";
    const isFixedPriceSale = false;
    const solanaAcceptedTokensLength = 2;
    SOLANA_TOKEN_INDEX_ONE = "01";
    SOLANA_TOKEN_INDEX_TWO = "02";
    ETH_TOKEN_INDEX = "00";

    // mint some more sale tokens
    await SOLD_TOKEN.mint(SELLER, saleTokenAmount);
    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // need to register a contributor contract
    const solanaContributorAddress = web3.eth.abi.encodeParameter(
      "bytes32",
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2)
    );

    await initialized.methods.registerChain(1, solanaContributorAddress).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_5_START,
      SALE_5_END,
      SALE_5_END, // unlock timestamp
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // make sure createSale fails when trying to pass more than 8 tokens
    {
      let testAcceptedTokens = [];

      // add 9 tokens to the accepted tokens list
      for (let i = 0; i < 9; i++) {
        // create random ethereum address for the accepted token (w/ wallet generation)
        const wallet = ethers.Wallet.createRandom();
        let defaultToken = [
          SOLANA_CHAIN_ID,
          "0x000000000000000000000000" + wallet.address.substr(2), // placeholder address
          tokenOneConversionRate,
        ];
        testAcceptedTokens.push(defaultToken);
      }

      let failed = false;
      try {
        // try to create sale with too many solana tokens (greater than 8)
        await initialized.methods.createSale(saleParams, testAcceptedTokens).send({
          value: WORMHOLE_FEE * 2,
          from: SELLER,
          gasLimit: GAS_LIMIT,
        });
      } catch (e) {
        assert.equal(
          e.message,
          "Returned error: VM Exception while processing transaction: revert too many solana tokens"
        );
        failed = true;
      }
      assert.ok(failed);
    }

    // mint new token to contribute in sale
    CONTRIBUTED_TOKEN_THREE = await TokenImplementation.new();
    const tokenOneName = "Contributed Stablecoin2";
    const tokenOneSymbol = "STABLE2";

    const mintAccount = accounts[0];
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test

    await CONTRIBUTED_TOKEN_THREE.initialize(
      tokenOneName,
      tokenOneSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await CONTRIBUTED_TOKEN_THREE.mint(BUYER_ONE, "100000"); // mint random number of new token

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_THREE.address.substr(2), tokenTwoConversionRate],
      [
        SOLANA_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), // placeholder address
        tokenOneConversionRate,
      ],
      [
        SOLANA_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), // placeholder address
        tokenTwoConversionRate,
      ],
    ];

    // create the sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE * 2,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // Verify Solana Payload sent to contributor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[1].returnValues;

    // verify payload
    assert.equal(log.sender, TokenSaleConductor.address);

    // payload id
    let index = 2;
    assert.equal(log.payload.substr(index, 2), payloadIdType5);
    index += 2;

    // sale id
    SALE_5_ID = SALE_4_ID + 1;
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_5_ID);
    index += 64;

    // solana ATA for sale token
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4)
    );
    index += 4;

    // token decimals
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLD_TOKEN_DECIMALS);
    index += 2;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_5_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_5_END);
    index += 64;

    // accepted tokens length
    assert.equal(parseInt(log.payload.substr(index, 2), 16), solanaAcceptedTokensLength);
    index += 2;

    // accepted token index
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLANA_TOKEN_INDEX_ONE);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2)
    );
    index += 64;

    // accepted token index
    assert.equal(parseInt(log.payload.substr(index, 2), 16), SOLANA_TOKEN_INDEX_TWO);
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2)
    );
    index += 64;

    // recipient of proceeds
    assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
    index += 64;

    // KYC authority public key
    assert.equal(log.payload.substr(index, 40), web3.eth.abi.encodeParameter("address", KYC_AUTHORITY).substring(26));
    index += 40;

    // unlock timestamp
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_5_END);
    index += 64;

    assert.equal(log.payload.length, index);

    // confirm that we are not accepting any solana tokens
    const sale = await initialized.methods.sales(SALE_5_ID).call();

    assert.equal(sale.solanaAcceptedTokensCount, solanaAcceptedTokensLength);
  });

  it("conductor should accept mock attestContribution VAAs from contributors", async function() {
    // skip to end of the sale
    await wait(20);

    // test variables
    const payloadIdType2 = "02";
    const solanaTokenContribution = "2000";
    const solanaTokenTwoContribution = "0";
    const ethereumTokenContribution = "1000";
    const acceptedTokensLengthSolana = 2;
    const acceptedTokensLengthEthereum = 1;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // construct contributions payload coming from Solana contributor
    const solanaContributionsSealed = [
      web3.eth.abi.encodeParameter("uint8", payloadIdType2).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint256", SALE_5_ID).substring(2),
      web3.eth.abi.encodeParameter("uint16", SOLANA_CHAIN_ID).substring(2 + (64 - 4)),
      web3.eth.abi.encodeParameter("uint8", acceptedTokensLengthSolana).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint8", SOLANA_TOKEN_INDEX_ONE).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint256", solanaTokenContribution).substring(2),
      web3.eth.abi.encodeParameter("uint8", SOLANA_TOKEN_INDEX_TWO).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint256", solanaTokenTwoContribution).substring(2),
    ];

    const vm = await signAndEncodeVM(
      1,
      1,
      SOLANA_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      "0x" + solanaContributionsSealed.join(""),
      [testSigner1PK],
      0,
      0
    );

    // collect contributions on the conductor
    await initialized.methods.collectContribution("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // construct contributions payload coming from ethereum contributor
    const ethereumContributionsSealed = [
      web3.eth.abi.encodeParameter("uint8", payloadIdType2).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint256", SALE_5_ID).substring(2),
      web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + (64 - 4)),
      web3.eth.abi.encodeParameter("uint8", acceptedTokensLengthEthereum).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint8", ETH_TOKEN_INDEX).substring(2 + (64 - 2)),
      web3.eth.abi.encodeParameter("uint256", ethereumTokenContribution).substring(2),
    ];

    const vm2 = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      "0x" + ethereumContributionsSealed.join(""),
      [testSigner1PK],
      0,
      0
    );

    // collect contributions on the conductor
    await initialized.methods.collectContribution("0x" + vm2).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // verify contributions with conductor getter
    const contributions = await initialized.methods.saleContributions(SALE_5_ID).call();

    assert.equal(solanaTokenContribution, contributions[parseInt(SOLANA_TOKEN_INDEX_ONE)]);
    assert.equal(solanaTokenTwoContribution, contributions[parseInt(SOLANA_TOKEN_INDEX_TWO)]);
    assert.equal(ethereumTokenContribution, contributions[parseInt(ETH_TOKEN_INDEX)]);
  });

  it("conductor sealSale should emit Solana specific VAA when accepting Solana tokens", async function() {
    // test variables
    const payloadIdType3 = "03";
    const numTokensInSolanaPayload = 2;
    const numTokensInEthereumPayload = 3;
    const solanaTokenAllocation = "5000000000000";
    const solanaTokenTwoAllocation = "0";
    const ethereumTokenAllocation = "5000000000000";
    const excessContribution = "0"; // same for all tokens - no excess contributions

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // seal the sale
    await initialized.methods.sealSale(SALE_5_ID).send({
      value: WORMHOLE_FEE * 3,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const log = await WORMHOLE.getPastEvents("LogMessagePublished", {
      fromBlock: "latest",
    });

    // grab payload from each of the emitted VAAs
    const solanaTransferPayload = log[0].returnValues;
    const ethereumSealedPayload = log[1].returnValues;
    const solanaSealedPayload = log[2].returnValues;

    // parse the solana and ethereum saleSealed payloads together
    // payload id
    let index = 2;
    assert.equal(ethereumSealedPayload.payload.substr(index, 2), payloadIdType3);
    assert.equal(solanaSealedPayload.payload.substr(index, 2), payloadIdType3);
    index += 2;

    // sale id
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(index, 64), 16), SALE_5_ID);
    assert.equal(parseInt(solanaSealedPayload.payload.substr(index, 64), 16), SALE_5_ID);
    index += 64;

    // allocations length
    assert.equal(ethereumSealedPayload.payload.substr(index, 2), numTokensInEthereumPayload);
    assert.equal(solanaSealedPayload.payload.substr(index, 2), numTokensInSolanaPayload);
    index += 2;

    // copy index
    let solanaIndex = index;
    let ethereumIndex = index;

    // parse solana token allocations and excess contributions
    assert.equal(solanaSealedPayload.payload.substr(solanaIndex, 2), SOLANA_TOKEN_INDEX_ONE);
    solanaIndex += 2;

    // solana allocation
    assert.equal(parseInt(solanaSealedPayload.payload.substr(solanaIndex, 64), 16), solanaTokenAllocation);
    solanaIndex += 64;

    // solana excess contribution
    assert.equal(parseInt(solanaSealedPayload.payload.substr(solanaIndex, 64), 16), excessContribution);
    solanaIndex += 64;

    // second allocation for solana tokens
    assert.equal(solanaSealedPayload.payload.substr(solanaIndex, 2), SOLANA_TOKEN_INDEX_TWO);
    solanaIndex += 2;

    // solana allocation
    assert.equal(parseInt(solanaSealedPayload.payload.substr(solanaIndex, 64), 16), solanaTokenTwoAllocation);
    solanaIndex += 64;

    // solana excess contribution
    assert.equal(parseInt(solanaSealedPayload.payload.substr(solanaIndex, 64), 16), excessContribution);
    solanaIndex += 64;

    // ethereum saleSealed wormhole message
    assert.equal(ethereumSealedPayload.payload.substr(ethereumIndex, 2), ETH_TOKEN_INDEX);
    ethereumIndex += 2;

    // eth allocation
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), ethereumTokenAllocation);
    ethereumIndex += 64;

    // eth excessContribution
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), excessContribution);
    ethereumIndex += 64;

    // index of solana token one in ethereum message
    assert.equal(ethereumSealedPayload.payload.substr(ethereumIndex, 2), SOLANA_TOKEN_INDEX_ONE);
    ethereumIndex += 2;

    // allocation of solana token one in ethereum message
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), solanaTokenAllocation);
    ethereumIndex += 64;

    // solana excess contribution for token one
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), excessContribution);
    ethereumIndex += 64;

    // index of solana token two in ethereum message
    assert.equal(ethereumSealedPayload.payload.substr(ethereumIndex, 2), SOLANA_TOKEN_INDEX_TWO);
    ethereumIndex += 2;

    // allocation of solana token one in ethereum message
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), solanaTokenTwoAllocation);
    ethereumIndex += 64;

    // solana excess contribution for token two
    assert.equal(parseInt(ethereumSealedPayload.payload.substr(ethereumIndex, 64), 16), excessContribution);
    ethereumIndex += 64;
  });

  // more global sale test variables
  let SALE_6_START;
  let SALE_6_END;
  let SALE_6_ID;
  let SALE_6_REFUND_RECIPIENT;

  it("create and init sixth sale correctly", async function() {
    console.log(
      "\n       -------------------------- Sale Test #6 (Successful Fixed Price Sale With Locked Allocations) --------------------------"
    );

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_6_START = current_block.timestamp + 5;
    SALE_6_END = SALE_6_START + 8;
    SALE_6_UNLOCK_TIMESTAMP = SALE_6_END + 30; // time when tokens can be claimed by contributors
    SALE_6_REFUND_RECIPIENT = accounts[1];
    const saleTokenAmount = "10000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "10000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const isFixedPriceSale = true;

    // mint some more sale tokens
    await SOLD_TOKEN.mint(SELLER, saleTokenAmount);
    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_6_START,
      SALE_6_END,
      SALE_6_UNLOCK_TIMESTAMP,
      saleRecipient,
      SALE_6_REFUND_RECIPIENT,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create the sale
    await initializedConductor.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE * 1,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    SALE_6_ID = SALE_5_ID + 1;

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create initSale VM
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // init the sale
    await initializedContributor.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initializedContributor.methods.getSaleTimeframe(SALE_6_ID).call();

    assert.equal(saleTimeframe.start, SALE_6_START);
    assert.equal(saleTimeframe.end, SALE_6_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_6_UNLOCK_TIMESTAMP);
  });

  it("should accept contributions in the contributor during the sixth sale timeframe", async function() {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = "6000";
    const tokenTwoContributionAmount = "1000";

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
      from: BUYER_ONE,
    });
    await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount, {
      from: BUYER_TWO,
    });

    // perform "kyc" and contribute to the token sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_6_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount,
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods.contribute(SALE_6_ID, TOKEN_ONE_INDEX, tokenOneContributionAmount, kycSig1).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    const kycSig2 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_6_ID,
      TOKEN_TWO_INDEX,
      tokenTwoContributionAmount,
      BUYER_TWO,
      kycSignerPK
    );
    await initialized.methods.contribute(SALE_6_ID, TOKEN_TWO_INDEX, tokenTwoContributionAmount, kycSig2).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });
  });

  it("conductor and contributor should attest contributions and seal the sixth sale correctly", async function() {
    await wait(10);

    // test variables
    const expectedTokenOneAllocation = "6000"; // 75% of what is allocated
    const expectedTokenTwoAllocation = "2000"; // 25% of what is allocated
    const expectedExcessContributions = "0"; // for both tokens
    const expectedSaleTokenRefund = "2000"; // sale token refund to refundRecipient
    const tokenOneContributionAmount = "6000";
    const tokenTwoContributionAmount = "1000";

    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // fetch the sale token balance of the refund recipient before sealing the sale
    const refundRecipientSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(SALE_6_REFUND_RECIPIENT);
    const recipientTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const recipientTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    // attest contributions
    await initializedContributor.methods.attestContributions(SALE_6_ID).send({
      from: BUYER_ONE,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // attest contributions
    await initializedConductor.methods.collectContribution("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // seal the sale in the conductor and check allocation details
    await initializedConductor.methods.sealSale(SALE_6_ID).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log2 = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm2 = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log2.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // seal the sale in the contributor
    await initializedContributor.methods.saleSealed("0x" + vm2).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify that the saleRecipient received the sale token refund
    // fetch the sale token balance of the refund recipient after sealing the sale
    const refundRecipientSaleTokenBalanceAfter = await SOLD_TOKEN.balanceOf(SALE_6_REFUND_RECIPIENT);

    assert.equal(
      parseInt(refundRecipientSaleTokenBalanceAfter) - parseInt(refundRecipientSaleTokenBalanceBefore),
      expectedSaleTokenRefund
    );

    // verify that the allocations/excessContributions are correct based on the fixedPrice calculations
    const tokenOneAllocation = await initializedContributor.methods
      .getSaleAllocation(SALE_6_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoAllocation = await initializedContributor.methods
      .getSaleAllocation(SALE_6_ID, TOKEN_TWO_INDEX)
      .call();

    const tokenOneExcessContribution = await initializedContributor.methods
      .getSaleExcessContribution(SALE_6_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoExcessContribution = await initializedContributor.methods
      .getSaleExcessContribution(SALE_6_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(tokenOneAllocation, expectedTokenOneAllocation);
    assert.equal(tokenTwoAllocation, expectedTokenTwoAllocation);
    assert.equal(tokenOneExcessContribution, expectedExcessContributions);
    assert.equal(tokenTwoExcessContribution, expectedExcessContributions);

    // confirm that the sale recipient received the contributed tokens
    const recipientTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const recipientTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    assert.equal(
      parseInt(recipientTokenOneBalanceAfter) - parseInt(recipientTokenOneBalanceBefore),
      tokenOneContributionAmount
    );
    assert.equal(
      parseInt(recipientTokenTwoBalanceAfter) - parseInt(recipientTokenTwoBalanceBefore),
      tokenTwoContributionAmount
    );
  });

  it("contributor should not distribute tokens before the unlock time", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    let failed = false;
    try {
      await initialized.methods.claimAllocation(SALE_6_ID, TOKEN_TWO_INDEX).send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert tokens have not been unlocked"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("contributor should distribute tokens after the unlock time", async function() {
    // wait for tokens to unlock
    await wait(30);

    // test variables
    const expectedBuyerOneAllocation = "6000"; // 75% of what is allocated
    const expectedBuyerTwoAllocation = "2000"; // 25% of what is allocated

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // check balances before claiming tokens
    const buyerOneBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const buyerTwoBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    // claim both allocations
    await initialized.methods.claimAllocation(SALE_6_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });
    await initialized.methods.claimAllocation(SALE_6_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

    // check balances after claiming tokens and make sure allocations are distributed correctly
    const buyerOneBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const buyerTwoBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(parseInt(buyerOneBalanceAfter) - parseInt(buyerOneBalanceBefore), expectedBuyerOneAllocation);
    assert.equal(parseInt(buyerTwoBalanceAfter) - parseInt(buyerTwoBalanceBefore), expectedBuyerTwoAllocation);
  });

  // more global sale test variables
  let SALE_7_START;
  let SALE_7_END;
  let SALE_7_ID;
  let SALE_7_REFUND_RECIPIENT;
  let MALICIOUS_SELLER;

  it("create and init seventh sale correctly", async function() {
    console.log(
      "\n       -------------------------- Sale Test #7 (Testing Reentrancy with ERC777 Token) --------------------------"
    );

    // test variables
    const current_block = await web3.eth.getBlock("latest");
    SALE_7_START = current_block.timestamp + 5;
    SALE_7_END = SALE_7_START + 8;
    SALE_7_UNLOCK_TIMESTAMP = SALE_7_END + 30; // time when tokens can be claimed by contributors

    const saleTokenAmount = "10000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "10000";
    const tokenOneConversionRate = "1000000000000000000";
    const saleRecipient = accounts[0];
    const isFixedPriceSale = true;

    await singletons.ERC1820Registry(accounts[0]);

    SOLD_TOKEN = await TokenERC777.deployed();
    SOLD_TOKEN_BYTES32_ADDRESS = "0x000000000000000000000000" + SOLD_TOKEN.address.substr(2);

    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    MALICIOUS_SELLER = await MaliciousSeller.deployed();
    SALE_7_REFUND_RECIPIENT = MALICIOUS_SELLER.address;
    await MALICIOUS_SELLER.setToken(SOLD_TOKEN.address);
    await MALICIOUS_SELLER.setConductor(initializedConductor._address);
    await MALICIOUS_SELLER.setWormholeFee(WORMHOLE_FEE);

    // mint some more sale tokens
    await SOLD_TOKEN.mint(SELLER, saleTokenAmount);
    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // Simulate SOLD_TOKEN from previously created sales (testing purposes)
    await SOLD_TOKEN.transfer(initializedConductor._address, "120000");

    web3.eth.sendTransaction({ to: SALE_7_REFUND_RECIPIENT, from: SELLER, value: web3.utils.toWei("1") });

    // create array (struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_7_START,
      SALE_7_END,
      SALE_7_UNLOCK_TIMESTAMP,
      saleRecipient,
      SALE_7_REFUND_RECIPIENT,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
    ];

    // create the sale
    await initializedConductor.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE * 1,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    SALE_7_ID = SALE_6_ID + 1;

    MALICIOUS_SELLER.setSaleId(SALE_7_ID);
    MALICIOUS_SELLER.setNumTimes(12);

    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create initSale VM
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // init the sale
    await initializedContributor.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initializedContributor.methods.getSaleTimeframe(SALE_7_ID).call();

    assert.equal(saleTimeframe.start, SALE_7_START);
    assert.equal(saleTimeframe.end, SALE_7_END);
    assert.equal(saleTimeframe.unlockTimestamp, SALE_7_UNLOCK_TIMESTAMP);
  });

  it("should accept contributions in the contributor during the seventh sale timeframe", async function() {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = "8000";

    await CONTRIBUTED_TOKEN_ONE.mint(BUYER_ONE, tokenOneContributionAmount);

    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
      from: BUYER_ONE,
    });

    // perform "kyc" and contribute to the token sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_7_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount,
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods.contribute(SALE_7_ID, TOKEN_ONE_INDEX, tokenOneContributionAmount, kycSig1).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });
  });

  it("sale should be aborted after attempted reentrancy attack with ERC777 token transfer", async function() {
    await wait(10);

    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // attest contributions
    await initializedContributor.methods.attestContributions(SALE_7_ID).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // attest contributions
    await initializedConductor.methods.collectContribution("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // confirm that saleAborted was set to true
    const conductorStatusBefore = await initializedConductor.methods.sales(SALE_7_ID).call();

    assert.ok(!conductorStatusBefore.isAborted);
    assert.ok(!conductorStatusBefore.isSealed);

    // attempt to seal the sale
    await initializedConductor.methods.sealSale(SALE_7_ID).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that saleAborted was set to true
    const conductorStatusAfter = await initializedConductor.methods.sales(SALE_7_ID).call();

    // both sealed and aborted since the ERC777 contract tried to cross-call the contract again
    assert.ok(conductorStatusAfter.isAborted);
    assert.ok(conductorStatusAfter.isSealed);

    const log2 = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // verify getSaleStatus before aborting in contributor
    const contributorStatusBefore = await initializedContributor.methods.getSaleStatus(SALE_7_ID).call();

    assert.ok(!contributorStatusBefore.isAborted);
    assert.ok(!contributorStatusBefore.isSealed);

    const vm2 = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log2.payload,
      [testSigner1PK],
      0,
      0
    );

    // abort the sale
    await initializedContributor.methods.saleAborted("0x" + vm2).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that saleAborted was set to true
    const contributorStatusAfter = await initializedContributor.methods.getSaleStatus(SALE_2_ID).call();

    assert.ok(contributorStatusAfter.isAborted);
    assert.ok(!contributorStatusAfter.isSealed);
  });

  it("conductor should not allow a sale to abort after the sale start time", async function() {
    console.log("\n       -------------------------- Other Tests --------------------------");
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    const saleId = await initialized.methods.getNextSaleId().call();

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      SOLD_TOKEN_BYTES32_ADDRESS,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenTwoConversionRate],
    ];

    // create another sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // wait for the sale to start
    await wait(6);

    let failed = false;
    try {
      // try to abort abort after the sale started
      await initialized.methods.abortSaleBeforeStartTime(saleId).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale cannot be aborted once it has started"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("contributor should not initialize a sale with non-ERC20 tokens", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "10";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const SOLD_TOKEN_DECIMALS = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test
    const isFixedPriceSale = false;

    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);
    const soldTokenBytes32 = "0x000000000000000000000000" + soldToken.address.substr(2);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array with a bad token address (non-ERC20)
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + accounts[0].substr(2), // create bad address by using wallet address
        tokenTwoConversionRate,
      ],
    ];

    // create another sale
    await initializedConductor.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    let failed = false;
    try {
      // try to initialize with a bad accepted token address
      await initializedContributor.methods.initSale("0x" + vm).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert non-existent ERC20");
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should only accept tokens with non-zero conversion rates", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "10";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "0"; // set to 0 for the test
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const SOLD_TOKEN_DECIMALS = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";
    const soldTokenBytes32 = "0x000000000000000000000000" + soldToken.address.substr(2);

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), // create bad address
        tokenTwoConversionRate,
      ],
    ];

    let failed = false;
    try {
      // try to create a sale with a token with zero multiplier
      await initialized.methods.createSale(saleParams, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert conversion rate cannot be zero"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should not accept duplicate tokens", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "10";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "10000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const SOLD_TOKEN_DECIMALS = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";
    const soldTokenBytes32 = "0x000000000000000000000000" + soldToken.address.substr(2);

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array with duplicate tokens (w/ same chainId)
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_THREE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_THREE.address.substr(2), tokenOneConversionRate],
    ];

    let failed = false;
    try {
      // try to create a sale with duplicate tokens (w/ same chainId)
      await initialized.methods.createSale(saleParams, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert duplicate tokens not allowed"
      );
      failed = true;
    }

    assert.ok(failed);

    // create accepted tokens array with duplicate tokens (no matching chainIds)
    const newChainId = 5;
    const acceptedTokens2 = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_THREE.address.substr(2), tokenOneConversionRate],
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2), tokenOneConversionRate],
      [newChainId, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
      [newChainId, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_THREE.address.substr(2), tokenOneConversionRate],
    ];

    // successfully create a sale with duplicate tokens (w/ different chainIds)
    await initialized.methods.createSale(saleParams, acceptedTokens2).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });
  });

  it("conductor should not accept sale start/end times larger than uint64", async function() {
    // test variables
    const saleStart = "100000000000000000000000";
    const saleEnd = "100000000000000000000001";
    const saleTokenAmount = "10";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const SOLD_TOKEN_DECIMALS = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test
    const isFixedPriceSale = false;

    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";
    const soldTokenBytes32 = "0x000000000000000000000000" + soldToken.address.substr(2);

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
    ];

    let failed = false;
    try {
      // try to create a sale with sale start/end times larger than uint64
      await initialized.methods.createSale(saleParams, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert saleStart too far in the future"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should allow fair launch sale (raiseAmount == minRaise && maxRaise)", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "2000";
    const tokenOneConversionRate = "1000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];
    const SOLD_TOKEN_DECIMALS = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test
    const isFixedPriceSale = false;

    // expected output
    const expectedAllocation = saleTokenAmount;
    const expectedExcessContribution = "0";

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";
    const soldTokenBytes32 = "0x000000000000000000000000" + soldToken.address.substr(2);

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      SOLD_TOKEN_DECIMALS,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // setup smart contracts
    const initializedConductor = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);
    const initializedContributor = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    const saleId = await initializedConductor.methods.getNextSaleId().call();

    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      saleRecipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
    ];

    // create another sale
    await initializedConductor.methods.createSale(saleParams, acceptedTokens).send({
      value: WORMHOLE_FEE,
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // initialize the sale
    await initializedContributor.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // wait for sale to start
    await wait(5);

    // make contribution equal to the minRaise amount
    await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, maximumTokenRaise, {
      from: BUYER_ONE,
    });

    // mint some more tokens to contribute with
    await CONTRIBUTED_TOKEN_ONE.mint(BUYER_ONE, maximumTokenRaise);

    // perform "kyc" and contribute tokens to the sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      saleId,
      TOKEN_ONE_INDEX,
      maximumTokenRaise,
      BUYER_ONE,
      kycSignerPK
    );
    await initializedContributor.methods
      .contribute(saleId, TOKEN_ONE_INDEX, parseInt(maximumTokenRaise), kycSig1)
      .send({
        from: BUYER_ONE,
        gasLimit: GAS_LIMIT,
      });

    // wait for sale to end
    await wait(10);

    // attest contributions
    await initializedContributor.methods.attestContributions(saleId).send({
      from: BUYER_ONE,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log2 = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm2 = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2),
      0,
      log2.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // attest contributions
    await initializedConductor.methods.collectContribution("0x" + vm2).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // seal the sale in the conductor and check allocation details
    await initializedConductor.methods.sealSale(saleId).send({
      from: SELLER,
      value: WORMHOLE_FEE,
      gasLimit: GAS_LIMIT,
    });

    // grab the message generated by the conductor
    const log3 = (
      await WORMHOLE.getPastEvents("LogMessagePublished", {
        fromBlock: "latest",
      })
    )[0].returnValues;

    // create the vaa to initialize the sale
    const vm3 = await signAndEncodeVM(
      1,
      1,
      TEST_CHAIN_ID,
      "0x000000000000000000000000" + TokenSaleConductor.address.substr(2),
      0,
      log3.payload.toString(),
      [testSigner1PK],
      0,
      0
    );

    // seal the sale in the contributor
    await initializedContributor.methods.saleSealed("0x" + vm3).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the allocations and excessContributions are correct
    const actualAllocation = await initializedContributor.methods.getSaleAllocation(saleId, TOKEN_ONE_INDEX).call();
    const actualExcessContribution = await initializedContributor.methods
      .getSaleExcessContribution(saleId, TOKEN_ONE_INDEX)
      .call();

    assert.equal(actualAllocation, expectedAllocation);
    assert.equal(actualExcessContribution, expectedExcessContribution);
  });

  it("conductor should sanity check addresses in Raise parameters", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "2000";
    const tokenOneConversionRate = "1000000000000000000";
    const recipient = accounts[0]; // make zero address for the test
    const refundRecipient = accounts[0];
    const isFixedPriceSale = false;
    const soldTokenBytes32 = "0x000000000000000000000000" + SOLD_TOKEN.address.substr(2);

    // setup smart contracts
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create array (solidity struct) for sale params
    const saleParams1 = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      ZERO_ADDRESS, // change the recipient address to address(0)
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    const saleParams2 = [
      isFixedPriceSale,
      ZERO_BYTES32, // change the sale token address to bytes32(0)
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleEnd,
      recipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
    ];

    let failed = false;
    try {
      // try to create a sale zero address for recipient
      await initialized.methods.createSale(saleParams1, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert recipient must not be address(0)"
      );
      failed = true;
    }

    assert.ok(failed);

    failed = false;
    try {
      // try to create a sale zero bytes32 for the sale token
      await initialized.methods.createSale(saleParams2, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert token must not be bytes32(0)"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should not allow a token vesting period greater than 2 years", async function() {
    // test variables
    const current_block = await web3.eth.getBlock("latest");
    const saleStart = current_block.timestamp + 5;
    const saleEnd = saleStart + 8;
    const saleUnlockTime = saleEnd + 63072001;
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "2000";
    const tokenOneConversionRate = "1000000000000000000";
    const recipient = accounts[0]; // make zero address for the test
    const refundRecipient = accounts[0];
    const isFixedPriceSale = true;
    const soldTokenBytes32 = "0x000000000000000000000000" + SOLD_TOKEN.address.substr(2);

    // setup smart contracts
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // create array (solidity struct) for sale params
    const saleParams = [
      isFixedPriceSale,
      soldTokenBytes32,
      TEST_CHAIN_ID,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleUnlockTime,
      recipient,
      refundRecipient,
      SOLD_TOKEN_BYTES32_ADDRESS,
      KYC_AUTHORITY,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [TEST_CHAIN_ID, "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2), tokenOneConversionRate],
    ];

    let failed = false;
    try {
      // try to create a sale where the unlock period begins > 2 years in the future
      await initialized.methods.createSale(saleParams, acceptedTokens).send({
        value: WORMHOLE_FEE,
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert unlock timestamp must be <= 2 years in the future"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("sdk should correctly convert conversion rates based on the saleToken decimals", async function() {
    // conversion rate ("price" * 1e18) for both accepted tokens
    const rawConversionRate = "1";

    // expected accepted token decimals
    const conductorDecimals = 9;
    const acceptedTokenDecimals = conductorDecimals;

    // decimals of the sale token on the Conductor chain
    const denominationDecimals1 = 6;
    const denominationDecimals2 = 18;
    const denominationDecimals3 = 9;

    // the expected output of the function
    const expectedNormalizedConversionRate1 = "1000000000000000";
    const expectedNormalizedConversionRate2 = "1000000000000000000000000000";
    const expectedNormalizedConversionRate3 = "1000000000000000000";

    // normalize to denom with 6 decimals
    const normalizedConversionRate1 = await normalizeConversionRate(
      denominationDecimals1,
      acceptedTokenDecimals,
      rawConversionRate,
      conductorDecimals
    );
    // normalize to denom with 18 decimals
    const normalizedConversionRate2 = await normalizeConversionRate(
      denominationDecimals2,
      acceptedTokenDecimals,
      rawConversionRate,
      conductorDecimals
    );
    // normalized to denomc with 9 decimals
    const normalizedConversionRate3 = await normalizeConversionRate(
      denominationDecimals3,
      acceptedTokenDecimals,
      rawConversionRate,
      conductorDecimals
    );

    // make sure the function is producing the expected result
    assert.equal(normalizedConversionRate1.toString(), expectedNormalizedConversionRate1);
    assert.equal(normalizedConversionRate2.toString(), expectedNormalizedConversionRate2);
    assert.equal(normalizedConversionRate3.toString(), expectedNormalizedConversionRate3);
  });
});

contract("ICCO Library Upgrade", function(accounts) {
  it("conductor should accept a valid upgrade with library changes", async function() {
    const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

    // deploy mock contracts and link ICCOStructs library
    const structs = await MockICCOStructs.new();
    await MockConductorImplementation2.link(structs, structs.address);
    const mock = await MockConductorImplementation2.new();

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleConductor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(before.toLowerCase(), ConductorImplementation.address.toLowerCase());

    await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    let after = await web3.eth.getStorageAt(
      TokenSaleConductor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(after.toLowerCase(), mock.address.toLowerCase());

    // call new conductor methods to confirm the upgrade was successful
    const mockImpl = new web3.eth.Contract(MockConductorImplementation2.abi, TokenSaleConductor.address);

    let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();
    let isConductorUpgraded = await mockImpl.methods.upgradeSuccessful().call();

    assert.ok(isUpgraded);
    assert.ok(isConductorUpgraded);

    // call new method in mock ICCO structs to confirm library upgrade was successful
    const mockICCOLib = new web3.eth.Contract(MockICCOStructs.abi, structs.address);

    let isLibraryUpgraded = await mockICCOLib.methods.testNewLibraryActive().call();

    assert.ok(isLibraryUpgraded);
  });

  it("contributor should accept a valid upgrade with library changes", async function() {
    const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

    // deploy mock contracts and link ICCOStructs library
    const structs = await MockICCOStructs.new();
    await MockContributorImplementation2.link(structs, structs.address);
    const mock = await MockContributorImplementation2.new();

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(before.toLowerCase(), ContributorImplementation.address.toLowerCase());

    await initialized.methods.upgrade(TEST_CHAIN_ID, mock.address).send({
      value: 0,
      from: accounts[0],
      gasLimit: GAS_LIMIT,
    });

    let after = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(after.toLowerCase(), mock.address.toLowerCase());

    // // call new contributor methods to confirm the upgrade was successful
    const mockImpl = new web3.eth.Contract(MockContributorImplementation2.abi, TokenSaleContributor.address);

    let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();
    let isContributorUpgraded = await mockImpl.methods.upgradeSuccessful().call();

    assert.ok(isUpgraded);
    assert.ok(isContributorUpgraded);

    // call new method in ICCO structs to confirm library upgrade was successful
    const mockICCOLib = new web3.eth.Contract(MockICCOStructs.abi, structs.address);

    let isLibraryUpgraded = await mockICCOLib.methods.testNewLibraryActive().call();

    assert.ok(isLibraryUpgraded);
  });
});

async function normalizeConversionRate(
  denominationDecimals,
  acceptedTokenDecimals,
  rawConversionRate,
  conductorDecimals
) {
  const precision = 18;
  const normDecimals = denominationDecimals + precision - acceptedTokenDecimals;
  let normalizedConversionRate = ethers.utils.parseUnits(rawConversionRate, normDecimals);

  if (acceptedTokenDecimals === conductorDecimals) {
    return normalizedConversionRate;
  } else if (acceptedTokenDecimals > conductorDecimals) {
    return normalizedConversionRate.div(ethers.utils.parseUnits("1", acceptedTokenDecimals - conductorDecimals));
  } else {
    return normalizedConversionRate.mul(ethers.utils.parseUnits("1", conductorDecimals - acceptedTokenDecimals));
  }
}

const signContribution = async function(conductorAddress, saleId, tokenIndex, amount, buyerAddress, signer) {
  // query for total contributed amount by this contributor
  const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);
  const totalContribution = await initialized.methods.getSaleContribution(saleId, tokenIndex, buyerAddress).call();

  const body = [
    web3.eth.abi.encodeParameter("bytes32", conductorAddress).substring(2),
    web3.eth.abi.encodeParameter("uint256", saleId).substring(2),
    web3.eth.abi.encodeParameter("uint256", tokenIndex).substring(2),
    web3.eth.abi.encodeParameter("uint256", amount).substring(2),
    web3.eth.abi.encodeParameter("address", buyerAddress).substring(2), // we actually want 32 bytes
    web3.eth.abi.encodeParameter("uint256", totalContribution).substring(2),
  ];

  // compute the hash
  const hash = web3.utils.soliditySha3("0x" + body.join(""));

  const ec = new elliptic.ec("secp256k1");
  const key = ec.keyFromPrivate(signer);
  const signature = key.sign(hash.substr(2), { canonical: true });

  const packSig = [
    zeroPadBytes(signature.r.toString(16), 32),
    zeroPadBytes(signature.s.toString(16), 32),
    web3.eth.abi.encodeParameter("uint8", signature.recoveryParam).substr(2 + (64 - 2)),
  ];

  return "0x" + packSig.join("");
};

const signAndEncodeVM = async function(
  timestamp,
  nonce,
  emitterChainId,
  emitterAddress,
  sequence,
  data,
  signers,
  guardianSetIndex,
  consistencyLevel
) {
  const body = [
    web3.eth.abi.encodeParameter("uint32", timestamp).substring(2 + (64 - 8)),
    web3.eth.abi.encodeParameter("uint32", nonce).substring(2 + (64 - 8)),
    web3.eth.abi.encodeParameter("uint16", emitterChainId).substring(2 + (64 - 4)),
    web3.eth.abi.encodeParameter("bytes32", emitterAddress).substring(2),
    web3.eth.abi.encodeParameter("uint64", sequence).substring(2 + (64 - 16)),
    web3.eth.abi.encodeParameter("uint8", consistencyLevel).substring(2 + (64 - 2)),
    data.substr(2),
  ];

  const hash = web3.utils.soliditySha3(web3.utils.soliditySha3("0x" + body.join("")));

  let signatures = "";

  for (let i in signers) {
    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPrivate(signers[i]);
    const signature = key.sign(hash.substr(2), { canonical: true });

    const packSig = [
      web3.eth.abi.encodeParameter("uint8", i).substring(2 + (64 - 2)),
      zeroPadBytes(signature.r.toString(16), 32),
      zeroPadBytes(signature.s.toString(16), 32),
      web3.eth.abi.encodeParameter("uint8", signature.recoveryParam).substr(2 + (64 - 2)),
    ];

    signatures += packSig.join("");
  }

  const vm = [
    web3.eth.abi.encodeParameter("uint8", 1).substring(2 + (64 - 2)),
    web3.eth.abi.encodeParameter("uint32", guardianSetIndex).substring(2 + (64 - 8)),
    web3.eth.abi.encodeParameter("uint8", signers.length).substring(2 + (64 - 2)),

    signatures,
    body.join(""),
  ].join("");

  return vm;
};

function zeroPadBytes(value, length) {
  while (value.length < 2 * length) {
    value = "0" + value;
  }
  return value;
}

wait = async (time) => {
  await advanceTimeAndBlock(time);
  // await timeout(time * 1000);
};

timeout = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

advanceTimeAndBlock = async (time) => {
  await advanceTime(time);
  await advanceBlock();

  return Promise.resolve(web3.eth.getBlock("latest"));
};

advanceTime = (time) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [time],
        id: new Date().getTime(),
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
};

advanceBlock = () => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        id: new Date().getTime(),
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        const newBlockHash = web3.eth.getBlock("latest").hash;

        return resolve(newBlockHash);
      }
    );
  });
};

revert = (snapshotId) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_revert",
        id: new Date().getTime(),
        params: [snapshotId],
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
};

snapshot = () => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_snapshot",
        id: new Date().getTime(),
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result.result);
      }
    );
  });
};
