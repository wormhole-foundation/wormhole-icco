const jsonfile = require("jsonfile");
const elliptic = require("elliptic");
const { assert } = require("chai");

const TokenImplementation = artifacts.require("TokenImplementation");

const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const TokenSaleContributor = artifacts.require("TokenSaleContributor");
const MockConductorImplementation = artifacts.require(
  "MockConductorImplementation"
);
const MockContributorImplementation = artifacts.require(
  "MockContributorImplementation"
);
const ICCOStructs = artifacts.require("ICCOStructs");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ContributorImplementation = artifacts.require(
  "ContributorImplementation"
);

// library upgrade test
const MockICCOStructs = artifacts.require("MockICCOStructs");
const MockConductorImplementation2 = artifacts.require(
  "MockConductorImplementation2"
);
const MockContributorImplementation2 = artifacts.require(
  "MockContributorImplementation2"
);

const testSigner1PK =
  "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
const kycSignerPK =
  "b0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773";

const WormholeImplementationFullABI = jsonfile.readFileSync(
  "wormhole/ethereum/build/contracts/Implementation.json"
).abi;
const ConductorImplementationFullABI = jsonfile.readFileSync(
  "build/contracts/ConductorImplementation.json"
).abi;
const ContributorImplementationFullABI = jsonfile.readFileSync(
  "build/contracts/ContributorImplementation.json"
).abi;
const ConsistencyLevel = process.env.CONSISTENCY_LEVEL;

// global variables
const TEST_CHAIN_ID = "2";
const GAS_LIMIT = "3000000";

const ethereumRootPath = `${__dirname}/..`;
const WormholeAddresses =
  require(`${ethereumRootPath}/wormhole-addresses.js`).development;

contract("ICCO", function (accounts) {
  const WORMHOLE = new web3.eth.Contract(
    WormholeImplementationFullABI,
    WormholeAddresses.wormhole
  );
  const CONDUCTOR_BYTES32_ADDRESS =
    "0x000000000000000000000000" + TokenSaleConductor.address.substr(2);

  it("conductor should be initialized with the correct values", async function () {
    console.log(
      "\n       -------------------------- Initialization and Upgrades --------------------------"
    );
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // chain id
    const chainId = await initialized.methods.chainId().call();
    assert.equal(chainId, TEST_CHAIN_ID);

    // wormhole
    const WORMHOLE = await initialized.methods.wormhole().call();
    assert.equal(WORMHOLE, WormholeAddresses.wormhole);

    // tokenBridge
    const tokenbridge = await initialized.methods.tokenBridge().call();
    assert.equal(tokenbridge, WormholeAddresses.tokenBridge);
  });

  it("contributor should be initialized with the correct values", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // chain id
    const chainId = await initialized.methods.chainId().call();
    assert.equal(chainId, TEST_CHAIN_ID);

    // conductor
    const conductorChainId = await initialized.methods
      .conductorChainId()
      .call();
    assert.equal(conductorChainId, TEST_CHAIN_ID);
    const conductorContract = await initialized.methods
      .conductorContract()
      .call();
    assert.equal(
      conductorContract.substr(26).toLowerCase(),
      TokenSaleConductor.address.substr(2).toLowerCase()
    );

    // wormhole
    const WORMHOLE = await initialized.methods.wormhole().call();
    assert.equal(WORMHOLE, WormholeAddresses.wormhole);

    // tokenBridge
    const tokenbridge = await initialized.methods.tokenBridge().call();
    assert.equal(tokenbridge, WormholeAddresses.tokenBridge);
  });

  it("conductor should register a contributor implementation correctly", async function () {
    const contributorAddress = web3.eth.abi.encodeParameter(
      "bytes32",
      "0x000000000000000000000000" + TokenSaleContributor.address.substr(2)
    );

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    let before = await initialized.methods
      .contributorContracts(TEST_CHAIN_ID)
      .call();

    assert.equal(
      before,
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    // attempt to register a chain from non-owner account
    let failed = false;
    try {
      await initialized.methods
        .registerChain(TEST_CHAIN_ID, contributorAddress)
        .send({
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

    await initialized.methods
      .registerChain(TEST_CHAIN_ID, contributorAddress)
      .send({
        value: 0,
        from: accounts[0],
        gasLimit: GAS_LIMIT,
      });

    let after = await initialized.methods
      .contributorContracts(TEST_CHAIN_ID)
      .call();

    assert.equal(
      after.substr(26).toLowerCase(),
      TokenSaleContributor.address.substr(2).toLowerCase()
    );

    // attempt to register a contributor a second time
    failed = false;
    try {
      await initialized.methods
        .registerChain(TEST_CHAIN_ID, contributorAddress)
        .send({
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

  it("conductor should accept a valid upgrade", async function () {
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

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

    assert.equal(
      before.toLowerCase(),
      ConductorImplementation.address.toLowerCase()
    );

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

    const mockImpl = new web3.eth.Contract(
      MockConductorImplementation.abi,
      TokenSaleConductor.address
    );

    let isUpgraded = await mockImpl.methods
      .testNewImplementationActive()
      .call();

    assert.ok(isUpgraded);
  });

  it("contributor should accept a valid upgrade", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(
      before.toLowerCase(),
      ContributorImplementation.address.toLowerCase()
    );

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

    const mockImpl = new web3.eth.Contract(
      MockContributorImplementation.abi,
      TokenSaleContributor.address
    );

    let isUpgraded = await mockImpl.methods
      .testNewImplementationActive()
      .call();

    assert.ok(isUpgraded);
  });

  it("contributor should should the allow owner to update authority correctly", async function () {
    // test variables
    const currentAuthority = process.env.KYC_SIGNER; // initalized value for authority
    const newAuthority = accounts[3];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // update the kyc authority
    await initialized.methods
      .updateAuthority(TEST_CHAIN_ID, newAuthority)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    // check getters after the action
    const contributorAuthorityAfterUpdate = await initialized.methods
      .authority()
      .call();

    assert.equal(contributorAuthorityAfterUpdate, newAuthority);

    // make sure only the Contributor owner can change authority
    let failed = false;
    try {
      await initialized.methods
        .updateAuthority(TEST_CHAIN_ID, currentAuthority)
        .send({
          value: "0",
          from: accounts[1], // different account
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

    // revert the autority change
    await initialized.methods
      .updateAuthority(TEST_CHAIN_ID, currentAuthority)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });
  });

  it("conductor and contributor should allow the owner to update consistencyLevel", async function () {
    // test variables
    const initializedConsistencyLevel = ConsistencyLevel;
    const updatedConsistencyLevel = "1";

    const contributorContract = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );
    const conductorContract = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // update the consistency level
    await contributorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, updatedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    await conductorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, updatedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    // check getters after the action
    const contributorConsistencyLevelAfter = await contributorContract.methods
      .consistencyLevel()
      .call();
    const conductorConsistencyLevelAfter = await conductorContract.methods
      .consistencyLevel()
      .call();

    assert.equal(contributorConsistencyLevelAfter, updatedConsistencyLevel);
    assert.equal(conductorConsistencyLevelAfter, updatedConsistencyLevel);

    // revert consistencyLevel back to initialized value
    // update the consistency level
    await contributorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    await conductorContract.methods
      .updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel)
      .send({
        value: "0",
        from: accounts[0], // contract owner
        gasLimit: GAS_LIMIT,
      });

    // make sure only the Contributor owner can change consistencyLevel
    let contributorFailed = false;
    try {
      await contributorContract.methods
        .updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel)
        .send({
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
      await conductorContract.methods
        .updateConsistencyLevel(TEST_CHAIN_ID, initializedConsistencyLevel)
        .send({
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

  it("conductor and contributor should allow the owner to transfer ownership", async function () {
    // test variables
    const currentOwner = accounts[0];
    const newOwner = accounts[1];

    const contributorContract = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );
    const conductorContract = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // transfer ownership
    await contributorContract.methods
      .transferOwnership(TEST_CHAIN_ID, newOwner)
      .send({
        value: "0",
        from: currentOwner, // contract owner
        gasLimit: GAS_LIMIT,
      });

    await conductorContract.methods
      .transferOwnership(TEST_CHAIN_ID, newOwner)
      .send({
        value: "0",
        from: currentOwner, // contract owner
        gasLimit: GAS_LIMIT,
      });

    // check getters after the action
    let contributorOwner = await contributorContract.methods.owner().call();
    let conductorOwner = await conductorContract.methods.owner().call();

    assert.equal(contributorOwner, newOwner);
    assert.equal(conductorOwner, newOwner);

    // make sure only the owner can transfer ownership
    let contributorFailed = false;
    try {
      await contributorContract.methods
        .transferOwnership(TEST_CHAIN_ID, currentOwner)
        .send({
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
    conductorFailed = false;
    try {
      await conductorContract.methods
        .transferOwnership(TEST_CHAIN_ID, currentOwner)
        .send({
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

    assert.ok(contributorFailed);
    assert.ok(conductorFailed);

    // revert ownership back to currentOwner
    await contributorContract.methods
      .transferOwnership(TEST_CHAIN_ID, currentOwner)
      .send({
        value: "0",
        from: newOwner,
        gasLimit: GAS_LIMIT,
      });

    await conductorContract.methods
      .transferOwnership(TEST_CHAIN_ID, currentOwner)
      .send({
        value: "0",
        from: newOwner,
        gasLimit: GAS_LIMIT,
      });

    // check getters before the action
    contributorOwner = await contributorContract.methods.owner().call();
    conductorOwner = await conductorContract.methods.owner().call();

    assert.equal(contributorOwner, currentOwner);
    assert.equal(conductorOwner, currentOwner);
  });

  // global sale test variables
  let SOLD_TOKEN;
  let CONTRIBUTED_TOKEN_ONE;
  let CONTRIBUTED_TOKEN_TWO;
  const SELLER = accounts[0];
  const BUYER_ONE = accounts[1];
  const BUYER_TWO = accounts[2];

  it("mint one token to sell, two to buy", async function () {
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
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";

    await SOLD_TOKEN.initialize(
      soldTokenName,
      soldTokenSymbol,
      tokenDecimals,
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
      tokenDecimals,
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
      tokenDecimals,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await CONTRIBUTED_TOKEN_TWO.mint(BUYER_TWO, contributedTokensMintAmount);

    // mint some token two to buyer1 for multi-asset contribution test
    await CONTRIBUTED_TOKEN_TWO.mint(BUYER_ONE, extraContributedTokensToMint);
  });

  // more global sale test variables
  let SALE_START;
  let SALE_END;
  let SALE_INIT_PAYLOAD;
  let SALE_ID = 0;
  let TOKEN_ONE_INDEX = 0;
  let TOKEN_TWO_INDEX = 1;

  it("create a sale correctly and attest over wormhole", async function () {
    console.log(
      "\n       -------------------------- Sale Test #1 (Successful) --------------------------"
    );

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

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (struct) for sale params
    const saleParams = [
      SOLD_TOKEN.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_START,
      SALE_END,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
        tokenTwoConversionRate,
      ],
    ];

    // create the sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: "0",
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
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // token amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(saleTokenAmount)
    );
    index += 64;

    // min raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(minimumTokenRaise)
    );
    index += 64;

    // max raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(maximumTokenRaise)
    );
    index += 64;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_END);
    index += 64;

    // accepted tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenOneConversionRate)
    );
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenTwoConversionRate)
    );
    index += 32;

    // recipient of proceeds
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    index += 64;

    // refund recipient in case the sale is aborted
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_INIT_PAYLOAD = log.payload.toString();

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_ID).call();

    assert.equal(sale.saleID, SALE_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
    assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_START);
    assert.equal(sale.saleEnd, SALE_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      parseInt(tokenOneConversionRate)
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      parseInt(tokenTwoConversionRate)
    );
    assert.equal(sale.initiator.substring(2), SELLER.substring(2));
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);
    assert.ok(!sale.refundIsClaimed);

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_ID + 1);
  });

  let INIT_SALE_VM;

  it("should init a sale in the contributor", async function () {
    // test variables
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "30000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "2000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // initialize the sale
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

    await initialized.methods.initSale("0x" + vm).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    INIT_SALE_VM = vm;

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_ID).call();

    assert.equal(sale.saleID, SALE_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
    assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_START);
    assert.equal(sale.saleEnd, SALE_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      parseInt(tokenOneConversionRate)
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      parseInt(tokenTwoConversionRate)
    );
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, parseInt(tokenOneConversionRate));
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, parseInt(tokenTwoConversionRate));

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods
      .getSaleTimeframe(SALE_ID)
      .call();

    assert.equal(saleTimeframe.start, SALE_START);
    assert.equal(saleTimeframe.end, SALE_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods.getSaleStatus(SALE_ID).call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("sale should only be initialized once in the contributor", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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

  it("should accept contributions in the contributor during the sale timeframe", async function () {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["5000", "5000"];
    const tokenTwoContributionAmount = ["5000", "2500"];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[0],
      {
        from: BUYER_TWO,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[1],
      {
        from: BUYER_ONE,
      }
    );

    // perform "kyc" and contribute to the token sale for BUYER_ONE
    const kycSig1 = await signContribution(
      CONDUCTOR_BYTES32_ADDRESS,
      SALE_ID,
      TOKEN_ONE_INDEX,
      tokenOneContributionAmount[0],
      BUYER_ONE,
      kycSignerPK
    );
    await initialized.methods
      .contribute(
        SALE_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[0]),
        kycSig1
      )
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
      .contribute(
        SALE_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[1]),
        kycSig2
      )
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
      .contribute(
        SALE_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[1]),
        kycSig3
      )
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
      .contribute(
        SALE_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[0]),
        kycSig4
      )
      .send({
        from: BUYER_TWO,
        gasLimit: GAS_LIMIT,
      });

    // verify getSaleTotalContribution after contributing
    const totalContributionsTokenOne = await initialized.methods
      .getSaleTotalContribution(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const totalContributionsTokenTwo = await initialized.methods
      .getSaleTotalContribution(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      totalContributionsTokenOne,
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) +
        parseInt(tokenTwoContributionAmount[1])
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
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      buyerOneContributionTokenTwo,
      parseInt(tokenTwoContributionAmount[1])
    );
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  it("should not accept contributions without proper KYC signature", async function () {
    // test variables
    const tokenOneContributionAmount = "10000";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      tokenOneContributionAmount,
      {
        from: BUYER_ONE,
      }
    );

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
        .contribute(
          SALE_ID,
          TOKEN_ONE_INDEX,
          parseInt(tokenOneContributionAmount),
          kycSig1
        )
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

  it("should not accept contributions in the contributor for non-existent saleIDs", async function () {
    // test variables
    const tokenOneContributionAmount = "10000";
    const incorrect_sale_id = "42069";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
        .contribute(
          incorrect_sale_id,
          TOKEN_ONE_INDEX,
          tokenOneContributionAmount,
          kycSig1
        )
        .send({
          from: BUYER_TWO,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale not initiated"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("should not accept contributions after the sale has ended", async function () {
    await wait(10);

    // test variables
    const tokenTwoContributionAmount = 5000;

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
      await initialized.methods
        .contribute(
          SALE_ID,
          TOKEN_TWO_INDEX,
          tokenTwoContributionAmount,
          kycSig1
        )
        .send({
          from: BUYER_TWO,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale has ended"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  let CONTRIBUTIONS_PAYLOAD;

  it("should attest contributions correctly", async function () {
    // test variables
    const tokenOneContributionAmount = 10000;
    const tokenTwoContributionAmount = 7500;
    const acceptedTokenLength = 2;
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // attest contributions
    await initialized.methods.attestContributions(SALE_ID).send({
      from: BUYER_ONE,
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
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
    index += 64;

    // chain id
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4)
    );
    index += 4;

    // tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi
        .encodeParameter("uint8", TOKEN_ONE_INDEX)
        .substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenOneContributionAmount
    );
    index += 64;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi
        .encodeParameter("uint8", TOKEN_TWO_INDEX)
        .substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenTwoContributionAmount
    );
    index += 64;

    assert.equal(log.payload.length, index);
    CONTRIBUTIONS_PAYLOAD = log.payload.toString();
  });

  it("conductor should collect contributions correctly", async function () {
    // test variables
    const tokenOneContributionAmount = 10000;
    const tokenTwoContributionAmount = 7500;

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

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
    const contributions = await initialized.methods
      .saleContributions(SALE_ID)
      .call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  it("conductor should not collect contributions more than once", async function () {
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

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

  it("conductor should not seal a sale for a non-existent saleID", async function () {
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    let failed = false;
    try {
      // try to seal a non-existent sale
      await initialized.methods.sealSale(SALE_ID + 10).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale not initiated"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should seal the sale correctly and distribute tokens", async function () {
    // test variables
    const expectedContributorBalanceBefore = "0";
    const expectedConductorBalanceBefore = "1000";
    const expectedContributorBalanceAfter = "1000";
    const expectedConductorBalanceAfter = "0";
    const payloadIdType3 = "03";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    assert.equal(
      actualContributorBalanceBefore,
      expectedContributorBalanceBefore
    );
    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

    // verify sealSealed flag in sales
    const saleBefore = await initialized.methods.sales(SALE_ID).call();

    assert.ok(!saleBefore.isSealed);

    // seal the sale
    await initialized.methods.sealSale(SALE_ID).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    assert.equal(
      actualContributorBalanceAfter,
      expectedContributorBalanceAfter
    );
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

  it("contributor should seal a sale correctly", async function () {
    // test variables
    const expectedAllocationTokenOne = "400";
    const expectedAllocationTokenTwo = "600";
    const expectedExcessTokenOne = "0";
    const expectedExcessTokenTwo = "0";
    const expectedRecipientTokenOneBalanceChange = "10000";
    const expectedRecipientTokenTwoBalanceChange = "7500";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // grab contributed token balance before for sale recipient
    const receipientTokenOneBalanceBefore =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceBefore =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

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
    await initialized.methods.saleSealed("0x" + vm).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

    // confirm that the sale was sealed
    const saleAfter = await initialized.methods.sales(SALE_ID).call();

    assert.ok(saleAfter.isSealed);

    // verify getSaleAllocation after sealing the sale
    const actualAllocationTokenOne = await initialized.methods
      .getSaleAllocation(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const actualAllocationTokenTwo = await initialized.methods
      .getSaleAllocation(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(actualAllocationTokenOne, expectedAllocationTokenOne);
    assert.equal(actualAllocationTokenTwo, expectedAllocationTokenTwo);

    // verify getSaleAllocation after sealing the sale
    const actualExcessTokenOne = await initialized.methods
      .getSaleExcessContribution(SALE_ID, TOKEN_ONE_INDEX)
      .call();
    const actualExcessTokenTwo = await initialized.methods
      .getSaleExcessContribution(SALE_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(actualExcessTokenOne, expectedExcessTokenOne);
    assert.equal(actualExcessTokenTwo, expectedExcessTokenTwo);

    // confirm that the sale recipient recieved the correct amount of contributions
    const receipientTokenOneBalanceAfter =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceAfter =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

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

  it("contributor should distribute tokens correctly", async function () {
    // test variables
    const expectedContributorBalanceBefore = "1000";
    const expectedBuyerOneBalanceBefore = "0";
    const expectedBuyerTwoBalanceBefore = "0";
    const expectedContributorBalanceAfter = "0";
    const expectedBuyerOneBalanceAfter = "600";
    const expectedBuyerTwoBalanceAfter = "400";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // check balances before claiming allocations
    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualBuyerOneBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(
      actualContributorBalanceBefore,
      expectedContributorBalanceBefore
    );
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
    await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
      from: BUYER_TWO,
      gasLimit: GAS_LIMIT,
    });

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
    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualBuyerOneBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_TWO);

    assert.equal(
      actualContributorBalanceAfter,
      expectedContributorBalanceAfter
    );
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

  it("allocation should only be claimable once", async function () {
    await revert(ONE_CLAIM_SNAPSHOT);

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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

  let SALE_2_START;
  let SALE_2_END;
  let SALE_2_INIT_PAYLOAD;
  let SALE_2_ID;
  const SALE_2_REFUND_RECIPIENT = accounts[5];

  it("create a second sale correctly and attest over wormhole", async function () {
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

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (struct) for sale params
    const saleParams = [
      SOLD_TOKEN.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_2_START,
      SALE_2_END,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
        tokenTwoConversionRate,
      ],
    ];

    // create a second sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: "0",
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
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // token amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(saleTokenAmount)
    );
    index += 64;

    // min raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(minimumTokenRaise)
    );
    index += 64;

    // max raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(maximumTokenRaise)
    );
    index += 64;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_END);
    index += 64;

    // accepted tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenOneConversionRate)
    );
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenTwoConversionRate)
    );
    index += 32;

    // recipient of proceeds
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    index += 64;

    // refund recipient in case the sale is aborted
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_2_INIT_PAYLOAD = log.payload.toString();

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_2_ID).call();

    assert.equal(sale.saleID, SALE_2_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
    assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_2_START);
    assert.equal(sale.saleEnd, SALE_2_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      parseInt(tokenOneConversionRate)
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      parseInt(tokenTwoConversionRate)
    );
    assert.equal(sale.initiator.substring(2), SELLER.substring(2));
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);
    assert.ok(!sale.refundIsClaimed);

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_2_ID + 1);
  });

  it("should init a second sale in the contributor", async function () {
    // test variables
    const saleTokenAmount = 1000;
    const minimumTokenRaise = 2000;
    const maximumTokenRaise = 30000;
    const tokenOneConversionRate = 1000000000000000000;
    const tokenTwoConversionRate = 2000000000000000000;
    const saleRecipient = accounts[0];
    const refundRecipient = SALE_2_REFUND_RECIPIENT;

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
    assert.equal(sale.tokenAmount, saleTokenAmount);
    assert.equal(sale.minRaise, minimumTokenRaise);
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_2_START);
    assert.equal(sale.saleEnd, SALE_2_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      tokenOneConversionRate
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      tokenTwoConversionRate
    );
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods
      .getSaleTimeframe(SALE_2_ID)
      .call();

    assert.equal(saleTimeframe.start, SALE_2_START);
    assert.equal(saleTimeframe.end, SALE_2_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods
      .getSaleStatus(SALE_2_ID)
      .call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("should accept contributions in the contributor during the second sale timeframe", async function () {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["500", "500"];
    const tokenTwoContributionAmount = ["100", "100"];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[0],
      {
        from: BUYER_TWO,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[1],
      {
        from: BUYER_ONE,
      }
    );

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
      .contribute(
        SALE_2_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[0]),
        kycSig1
      )
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
      .contribute(
        SALE_2_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[1]),
        kycSig2
      )
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
      .contribute(
        SALE_2_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[1]),
        kycSig3
      )
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
      .contribute(
        SALE_2_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[0]),
        kycSig4
      )
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
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) +
        parseInt(tokenTwoContributionAmount[1])
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
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      buyerOneContributionTokenTwo,
      parseInt(tokenTwoContributionAmount[1])
    );
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  let CONTRIBUTIONS_PAYLOAD_2;

  it("should attest contributions for second sale correctly", async function () {
    await wait(10);

    // test variables
    const tokenOneContributionAmount = 1000;
    const tokenTwoContributionAmount = 200;
    const acceptedTokenLength = 2;
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // attest contributions
    await initialized.methods.attestContributions(SALE_2_ID).send({
      from: BUYER_ONE,
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
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4)
    );
    index += 4;

    // tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenOneContributionAmount
    );
    index += 64;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenTwoContributionAmount
    );
    index += 64;

    assert.equal(log.payload.length, index);

    CONTRIBUTIONS_PAYLOAD_2 = log.payload.toString();
  });

  it("conductor should collect second sale contributions correctly", async function () {
    // test variables
    const tokenOneContributionAmount = 1000;
    const tokenTwoContributionAmount = 200;

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

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
    const contributions = await initialized.methods
      .saleContributions(SALE_2_ID)
      .call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  let SALE_SEALED_PAYLOAD_2;

  it("conductor should abort the second sale correctly", async function () {
    // test variables
    const expectedContributorBalance = "600";
    const expectedConductorBalance = "1000";
    const payloadIdType4 = "04";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    // confirm that the sale is not aborted yet
    const saleBefore = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(!saleBefore.isAborted);

    // contributor balance is 500 before because of the reverted transaction
    // in "allocation should only be claimable once"
    assert.equal(actualContributorBalanceBefore, expectedContributorBalance);
    assert.equal(actualConductorBalanceBefore, expectedConductorBalance);

    await initialized.methods.sealSale(SALE_2_ID).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    // make sure balances haven't changed
    assert.equal(actualContributorBalanceAfter, expectedContributorBalance);
    assert.equal(actualConductorBalanceAfter, expectedConductorBalance);

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
    assert.equal(
      parseInt(SALE_SEALED_PAYLOAD_2.substr(index, 64), 16),
      SALE_2_ID
    );
    index += 64;

    // confirm that the sale is aborted
    const saleAfter = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(saleAfter.isAborted);
  });

  it("contributor should abort second sale correctly", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // verify getSaleStatus before aborting in contributor
    const statusBefore = await initialized.methods
      .getSaleStatus(SALE_2_ID)
      .call();

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
    const statusAfter = await initialized.methods
      .getSaleStatus(SALE_2_ID)
      .call();

    assert.ok(statusAfter.isAborted);
    assert.ok(!statusAfter.isSealed);
  });

  it("conductor should distribute refund to refundRecipient correctly", async function () {
    // test variables
    const expectedConductorBalanceBefore = "1000";
    const expectedSellerBalanceBefore = "0";
    const expectedConductorBalanceAfter = "0";
    const expectedSellerBalanceAfter = "1000";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // confirm that refundIsClaimed is false
    const saleBefore = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(!saleBefore.refundIsClaimed);

    // check starting balances
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );
    const actualSellerBalanceBefore = await SOLD_TOKEN.balanceOf(
      SALE_2_REFUND_RECIPIENT
    );

    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);
    assert.equal(actualSellerBalanceBefore, expectedSellerBalanceBefore);

    // claim the sale token refund
    await initialized.methods.claimRefund(SALE_2_ID).send({
      from: BUYER_ONE, // confirm that it's permissionless
      gasLimit: GAS_LIMIT,
    });

    // make sure new balances are correct
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );
    const actualSellerBalanceAfter = await SOLD_TOKEN.balanceOf(
      SALE_2_REFUND_RECIPIENT
    );

    assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);
    assert.equal(actualSellerBalanceAfter, expectedSellerBalanceAfter);

    // confirm that refundClaimed was set to true
    const saleAfter = await initialized.methods.sales(SALE_2_ID).call();

    assert.ok(saleAfter.refundIsClaimed);

    // send refunded tokens back to SELLER account
    await SOLD_TOKEN.approve(SELLER, actualSellerBalanceAfter, {
      from: SALE_2_REFUND_RECIPIENT,
    });
    await SOLD_TOKEN.transferFrom(
      SALE_2_REFUND_RECIPIENT,
      SELLER,
      actualSellerBalanceAfter
    );
  });

  let ONE_REFUND_SNAPSHOT;

  it("contributor should distribute refunds to contributors correctly", async function () {
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

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
    const actualContributorTokenOneBalanceBefore =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceBefore =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);

    assert.equal(
      actualContributorTokenOneBalanceBefore,
      expectedContributorTokenOneBalanceBefore
    );
    assert.equal(
      actualContributorTokenTwoBalanceBefore,
      expectedContributorTokenTwoBalanceBefore
    );

    // check buyer balances
    const actualBuyerOneTokenOneBalanceBefore =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerOneTokenTwoBalanceBefore =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

    assert.equal(
      actualBuyerOneTokenOneBalanceBefore,
      expectedBuyerOneTokenOneBalanceBefore
    );
    assert.equal(
      actualBuyerOneTokenTwoBalanceBefore,
      expectedBuyerOneTokenTwoBalanceBefore
    );
    assert.equal(actualBuyerTwoBalanceBefore, expectedBuyerTwoBalanceBefore);

    // BUYER_ONE/BUYER_TWO claims refunds
    await initialized.methods.claimRefund(SALE_2_ID, TOKEN_ONE_INDEX).send({
      from: BUYER_ONE,
      gasLimit: GAS_LIMIT,
    });

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
    const actualContributorTokenOneBalanceAfter =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceAfter =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);

    assert.equal(
      actualContributorTokenOneBalanceAfter,
      expectedContributorTokenOneBalanceAfter
    );
    assert.equal(
      actualContributorTokenTwoBalanceAfter,
      expectedContributorTokenTwoBalanceAfter
    );

    // check buyer balances after claiming refund
    const actualBuyerOneTokenOneBalanceAfter =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
    const actualBuyerOneTokenTwoBalanceAfter =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_ONE);
    const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

    assert.equal(
      actualBuyerOneTokenOneBalanceAfter,
      expectedBuyerOneTokenOneBalanceAfter
    );
    assert.equal(
      actualBuyerOneTokenTwoBalanceAfter,
      expectedBuyerOneTokenTwoBalanceAfter
    );
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

  it("refund should only be claimable once in contributor", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    await revert(ONE_REFUND_SNAPSHOT);

    let failed = false;
    try {
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

  it("refund should only be claimable once in conductor", async function () {
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    let failed = false;
    try {
      // claim the sale token refund
      await initialized.methods.claimRefund(SALE_2_ID).send({
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert already claimed"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  let SALE_3_START;
  let SALE_3_END;
  let SALE_3_INIT_PAYLOAD;
  let SALE_3_ID;

  it("create a third sale correctly and attest over wormhole", async function () {
    console.log(
      "\n       -------------------------- Sale Test #3 (Aborted Early) --------------------------"
    );

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

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      SOLD_TOKEN.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_3_START,
      SALE_3_END,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
        tokenTwoConversionRate,
      ],
    ];

    // create a third sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: "0",
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
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // token amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(saleTokenAmount)
    );
    index += 64;

    // min raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(minimumTokenRaise)
    );
    index += 64;

    // max raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(maximumTokenRaise)
    );
    index += 64;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_END);
    index += 64;

    // accepted tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenOneConversionRate)
    );
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenTwoConversionRate)
    );
    index += 32;

    // recipient of proceeds
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    index += 64;

    // refund recipient in case the sale is aborted
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_3_INIT_PAYLOAD = log.payload.toString();

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_3_ID).call();

    assert.equal(sale.saleID, SALE_3_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
    assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_3_START);
    assert.equal(sale.saleEnd, SALE_3_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      parseInt(tokenOneConversionRate)
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      parseInt(tokenTwoConversionRate)
    );
    assert.equal(sale.initiator.substring(2), SELLER.substring(2));
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);
    assert.ok(!sale.refundIsClaimed);

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_3_ID + 1);
  });

  it("should init a third sale in the contributor", async function () {
    // test variables
    const saleTokenAmount = 1000;
    const minimumTokenRaise = 2000;
    const maximumTokenRaise = 30000;
    const tokenOneConversionRate = 1000000000000000000;
    const tokenTwoConversionRate = 2000000000000000000;
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
    assert.equal(sale.tokenAmount, saleTokenAmount);
    assert.equal(sale.minRaise, minimumTokenRaise);
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_3_START);
    assert.equal(sale.saleEnd, SALE_3_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      tokenOneConversionRate
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      tokenTwoConversionRate
    );
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods
      .getSaleTimeframe(SALE_3_ID)
      .call();

    assert.equal(saleTimeframe.start, SALE_3_START);
    assert.equal(saleTimeframe.end, SALE_3_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods
      .getSaleStatus(SALE_3_ID)
      .call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  let SALE_SEALED_PAYLOAD_3;

  it("conductor should abort sale before the third sale starts", async function () {
    // test variables
    const payloadIdType4 = "04";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // verify getSaleStatus getter before aborting
    const saleStatusBefore = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(!saleStatusBefore.isSealed);
    assert.ok(!saleStatusBefore.isAborted);

    // make sure only the initiator can abort the sale early
    let failed = false;
    try {
      await initialized.methods.abortSaleBeforeStartTime(SALE_3_ID).send({
        from: BUYER_ONE,
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

    // abort the sale
    await initialized.methods.abortSaleBeforeStartTime(SALE_3_ID).send({
      from: SELLER, // must be the sale initiator (msg.sender in createSale())
      gasLimit: GAS_LIMIT,
    });

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
    assert.equal(
      parseInt(SALE_SEALED_PAYLOAD_3.substr(index, 64), 16),
      SALE_3_ID
    );
    index += 64;

    // verify getSaleStatus getter after aborting
    const saleStatusAfter = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(!saleStatusAfter.isSealed);
    assert.ok(saleStatusAfter.isAborted);
  });

  it("should accept contributions after sale period starts and before aborting the sale (block timestamps out of sync test)", async function () {
    // this test simulates block timestamps being out of sync cross-chain
    await wait(5);

    // test variables
    const tokenOneContributionAmount = "100";
    const tokenTwoContributionAmount = "50";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      tokenOneContributionAmount,
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount,
      {
        from: BUYER_TWO,
      }
    );

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
      .contribute(
        SALE_3_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount),
        kycSig1
      )
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
      .contribute(
        SALE_3_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount),
        kycSig2
      )
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

    assert.equal(
      totalContributionsTokenOne,
      parseInt(tokenOneContributionAmount)
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount)
    );

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

  it("contributor should abort third sale correctly", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // verify getSaleStatus before aborting in contributor
    const statusBefore = await initialized.methods
      .getSaleStatus(SALE_3_ID)
      .call();

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
    const statusAfter = await initialized.methods
      .getSaleStatus(SALE_3_ID)
      .call();

    assert.ok(statusAfter.isAborted);
    assert.ok(!statusAfter.isSealed);
  });

  it("contributor should not allow contributions after sale is aborted early", async function () {
    // test variables
    const tokenOneContributionAmount = "100";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      tokenOneContributionAmount,
      {
        from: BUYER_ONE,
      }
    );

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
        .contribute(
          SALE_3_ID,
          TOKEN_ONE_INDEX,
          parseInt(tokenOneContributionAmount),
          kycSig1
        )
        .send({
          from: BUYER_ONE,
          gasLimit: GAS_LIMIT,
        });
    } catch (e) {
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert sale was aborted"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("contributor should not allow contributions to be attested after sale is aborted early", async function () {
    await wait(10);

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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

  it("conductor should distribute refund to refundRecipient correctly after sale is aborted early", async function () {
    // test variables
    const expectedConductorBalanceBefore = "1000";
    const expectedSellerBalanceBefore = "0";
    const expectedConductorBalanceAfter = "0";
    const expectedSellerBalanceAfter = "1000";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // confirm that refundIsClaimed is false
    const saleBefore = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(!saleBefore.refundIsClaimed);

    // check starting balances
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );
    const actualSellerBalanceBefore = await SOLD_TOKEN.balanceOf(SELLER);

    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);
    assert.equal(actualSellerBalanceBefore, expectedSellerBalanceBefore);

    // claim the sale token refund
    await initialized.methods.claimRefund(SALE_3_ID).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // make sure new balances are correct
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );
    const actualSellerBalanceAfter = await SOLD_TOKEN.balanceOf(SELLER);

    assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);
    assert.equal(actualSellerBalanceAfter, expectedSellerBalanceAfter);

    // confirm that refundClaimed was set to true
    const saleAfter = await initialized.methods.sales(SALE_3_ID).call();

    assert.ok(saleAfter.refundIsClaimed);
  });

  it("contributor should distribute refunds to contributors correctly after sale is aborted early", async function () {
    // test variables
    const expectedContributorTokenOneBalanceBefore = "100"; // 100 contributed
    const expectedContributorTokenTwoBalanceBefore = "250"; // 50 contributed - there is some residual amount from a previous test
    const expectedBuyerOneBalanceBefore = "9900";
    const expectedBuyerTwoBalanceBefore = "14850";
    const expectedContributorTokenOneBalanceAfter = "0";
    const expectedContributorTokenTwoBalanceAfter = "200";
    const expectedBuyerOneBalanceAfter = "10000";
    const expectedBuyerTwoBalanceAfter = "14900";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
    const actualContributorTokenOneBalanceBefore =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceBefore =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(
      BUYER_ONE
    );
    const actualBuyerTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

    assert.equal(
      actualContributorTokenOneBalanceBefore,
      expectedContributorTokenOneBalanceBefore
    );
    assert.equal(
      actualContributorTokenTwoBalanceBefore,
      expectedContributorTokenTwoBalanceBefore
    );
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
    const actualContributorTokenOneBalanceAfter =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
    const actualContributorTokenTwoBalanceAfter =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);
    const actualBuyerOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(
      BUYER_ONE
    );
    const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

    assert.equal(
      actualContributorTokenOneBalanceAfter,
      expectedContributorTokenOneBalanceAfter
    );
    assert.equal(
      actualContributorTokenTwoBalanceAfter,
      expectedContributorTokenTwoBalanceAfter
    );
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

  it("create a fourth sale correctly and attest over wormhole", async function () {
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

    // mint some more sale tokens
    await SOLD_TOKEN.mint(SELLER, saleTokenMintAmount);
    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // create array (struct) for sale params
    const saleParams = [
      SOLD_TOKEN.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      SALE_4_START,
      SALE_4_END,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
        tokenTwoConversionRate,
      ],
    ];

    // create the sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: "0",
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
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // token amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(saleTokenAmount)
    );
    index += 64;

    // min raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(minimumTokenRaise)
    );
    index += 64;

    // max raise amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      parseInt(maximumTokenRaise)
    );
    index += 64;

    // timestamp start
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_START);
    index += 64;

    // timestamp end
    assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_4_END);
    index += 64;

    // accepted tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenOneConversionRate)
    );
    index += 32;

    // token address
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    index += 64;

    // token chain
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi
        .encodeParameter("uint16", TEST_CHAIN_ID)
        .substring(2 + 64 - 4)
    );
    index += 4;

    // conversion rate
    assert.equal(
      parseInt(log.payload.substr(index, 32), 16),
      parseInt(tokenTwoConversionRate)
    );
    index += 32;

    // recipient of proceeds
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    index += 64;

    // refund recipient in case the sale is aborted
    assert.equal(
      log.payload.substr(index, 64),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    index += 64;

    assert.equal(log.payload.length, index);
    SALE_4_INIT_PAYLOAD = log.payload.toString();

    // verify sale getter
    const sale = await initialized.methods.sales(SALE_4_ID).call();

    assert.equal(sale.saleID, SALE_4_ID);
    assert.equal(
      sale.tokenAddress.substring(2),
      web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2)
    );
    assert.equal(sale.tokenChain, TEST_CHAIN_ID);
    assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
    assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_4_START);
    assert.equal(sale.saleEnd, SALE_4_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      parseInt(tokenOneConversionRate)
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      parseInt(tokenTwoConversionRate)
    );
    assert.equal(sale.initiator.substring(2), SELLER.substring(2));
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);
    assert.ok(!sale.refundIsClaimed);

    // verify that getNextSaleId is correct
    const nextSaleId = await initialized.methods.getNextSaleId().call();

    assert.equal(nextSaleId, SALE_4_ID + 1);
  });

  it("should init a fourth sale in the contributor", async function () {
    // test variables
    const saleTokenAmount = "1000";
    const minimumTokenRaise = "2000";
    const maximumTokenRaise = "6000";
    const tokenOneConversionRate = "1000000000000000000";
    const tokenTwoConversionRate = "4000000000000000000";
    const saleRecipient = accounts[0];
    const refundRecipient = accounts[0];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

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
    assert.equal(sale.tokenAmount, saleTokenAmount);
    assert.equal(sale.minRaise, minimumTokenRaise);
    assert.equal(sale.maxRaise, parseInt(maximumTokenRaise));
    assert.equal(sale.saleStart, SALE_4_START);
    assert.equal(sale.saleEnd, SALE_4_END);
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX],
      tokenOneConversionRate
    );
    assert.equal(
      sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
    assert.equal(
      sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX],
      tokenTwoConversionRate
    );
    assert.equal(
      sale.recipient.substring(2),
      web3.eth.abi.encodeParameter("address", saleRecipient).substring(2)
    );
    assert.equal(
      sale.refundRecipient.substring(2),
      web3.eth.abi.encodeParameter("address", refundRecipient).substring(2)
    );
    assert.equal(sale.allocations[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.allocations[TOKEN_TWO_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_ONE_INDEX], 0);
    assert.equal(sale.excessContributions[TOKEN_TWO_INDEX], 0);
    assert.ok(!sale.isSealed);
    assert.ok(!sale.isAborted);

    // verify getsaleAcceptedTokenInfo getter
    const tokenOneInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const tokenTwoInfo = await initialized.methods
      .getSaleAcceptedTokenInfo(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(
      tokenOneInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address)
        .substring(2)
    );
    assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
    assert.equal(
      tokenTwoInfo.tokenAddress.substring(2),
      web3.eth.abi
        .encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address)
        .substring(2)
    );
    assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
    assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

    // verify getSaleTimeFrame getter
    const saleTimeframe = await initialized.methods
      .getSaleTimeframe(SALE_4_ID)
      .call();

    assert.equal(saleTimeframe.start, SALE_4_START);
    assert.equal(saleTimeframe.end, SALE_4_END);

    // verify getSaleStatus getter
    const saleStatus = await initialized.methods
      .getSaleStatus(SALE_4_ID)
      .call();

    assert.ok(!saleStatus.isSealed);
    assert.ok(!saleStatus.isAborted);
  });

  it("should accept contributions in the contributor during the fourth sale timeframe", async function () {
    await wait(5);

    // test variables
    const tokenOneContributionAmount = ["2000", "4000"];
    const tokenTwoContributionAmount = ["500", "500"];

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // approve contribution amounts
    await CONTRIBUTED_TOKEN_ONE.approve(
      TokenSaleContributor.address,
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1]),
      {
        from: BUYER_ONE,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[0],
      {
        from: BUYER_TWO,
      }
    );
    await CONTRIBUTED_TOKEN_TWO.approve(
      TokenSaleContributor.address,
      tokenTwoContributionAmount[1],
      {
        from: BUYER_ONE,
      }
    );

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
      .contribute(
        SALE_4_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[0]),
        kycSig1
      )
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
      .contribute(
        SALE_4_ID,
        TOKEN_ONE_INDEX,
        parseInt(tokenOneContributionAmount[1]),
        kycSig2
      )
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
      .contribute(
        SALE_4_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[1]),
        kycSig3
      )
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
      .contribute(
        SALE_4_ID,
        TOKEN_TWO_INDEX,
        parseInt(tokenTwoContributionAmount[0]),
        kycSig4
      )
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
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      totalContributionsTokenTwo,
      parseInt(tokenTwoContributionAmount[0]) +
        parseInt(tokenTwoContributionAmount[1])
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
      parseInt(tokenOneContributionAmount[0]) +
        parseInt(tokenOneContributionAmount[1])
    );
    assert.equal(
      buyerOneContributionTokenTwo,
      parseInt(tokenTwoContributionAmount[1])
    );
    assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount[0]));
  });

  let CONTRIBUTIONS_PAYLOAD_4;

  it("should attest contributions for fourth sale correctly", async function () {
    await wait(10);

    // test variables
    const tokenOneContributionAmount = "6000"; // sum of both contributions
    const tokenTwoContributionAmount = "1000";
    const acceptedTokenLength = "2";
    const payloadIdType2 = "02";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // attest contributions
    await initialized.methods.attestContributions(SALE_4_ID).send({
      from: BUYER_ONE,
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
    assert.equal(
      log.payload.substr(index, 4),
      web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4)
    );
    index += 4;

    // tokens length
    assert.equal(
      parseInt(log.payload.substr(index, 2), 16),
      acceptedTokenLength
    );
    index += 2;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenOneContributionAmount
    );
    index += 64;

    // token index
    assert.equal(
      log.payload.substr(index, 2),
      web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2)
    );
    index += 2;

    // amount
    assert.equal(
      parseInt(log.payload.substr(index, 64), 16),
      tokenTwoContributionAmount
    );
    index += 64;

    assert.equal(log.payload.length, index);

    CONTRIBUTIONS_PAYLOAD_4 = log.payload.toString();
  });

  it("conductor should collect fourth sale contributions correctly", async function () {
    // test variables
    const tokenOneContributionAmount = "6000"; // both contributions
    const tokenTwoContributionAmount = "1000";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

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
    const contributions = await initialized.methods
      .saleContributions(SALE_4_ID)
      .call();

    assert.equal(contributions[0], tokenOneContributionAmount);
    assert.equal(contributions[1], tokenTwoContributionAmount);
  });

  let SALE_SEALED_PAYLOAD_4;

  it("conductor should seal the fourth sale correctly and distribute tokens", async function () {
    // test variables
    const expectedContributorBalanceBefore = "600";
    const expectedConductorBalanceBefore = "1000";
    const expectedContributorBalanceAfter = "1600";
    const expectedConductorBalanceAfter = "0";
    const payloadIdType3 = "03";

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    assert.equal(
      actualContributorBalanceBefore,
      expectedContributorBalanceBefore
    );
    assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

    // verify sealSealed flag in sales
    const saleBefore = await initialized.methods.sales(SALE_4_ID).call();

    assert.ok(!saleBefore.isSealed);

    // seal the sale
    await initialized.methods.sealSale(SALE_4_ID).send({
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleConductor.address
    );

    assert.equal(
      actualContributorBalanceAfter,
      expectedContributorBalanceAfter
    );
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

  it("contributor should seal the fourth sale correctly", async function () {
    // test variables
    const expectedAllocationTokenOne = "600";
    const expectedAllocationTokenTwo = "400";
    const expectedExcessTokenOne = "2400";
    const expectedExcessTokenTwo = "400";
    const expectedRecipientTokenOneBalanceChange = "3600";
    const expectedRecipientTokenTwoBalanceChange = "600";

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // grab contributed token balance before for sale recipient
    const receipientTokenOneBalanceBefore =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceBefore =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

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
    const actualAllocationTokenOne = await initialized.methods
      .getSaleAllocation(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const actualAllocationTokenTwo = await initialized.methods
      .getSaleAllocation(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(actualAllocationTokenOne, expectedAllocationTokenOne);
    assert.equal(actualAllocationTokenTwo, expectedAllocationTokenTwo);

    // verify getSaleExcessContribution after sealing the sale
    const actualExcessTokenOne = await initialized.methods
      .getSaleExcessContribution(SALE_4_ID, TOKEN_ONE_INDEX)
      .call();
    const actualExcessTokenTwo = await initialized.methods
      .getSaleExcessContribution(SALE_4_ID, TOKEN_TWO_INDEX)
      .call();

    assert.equal(actualExcessTokenOne, expectedExcessTokenOne);
    assert.equal(actualExcessTokenTwo, expectedExcessTokenTwo);

    // confirm that the sale recipient recieved the correct amount of contributions
    const receipientTokenOneBalanceAfter =
      await CONTRIBUTED_TOKEN_ONE.balanceOf(SELLER);
    const receipientTokenTwoBalanceAfter =
      await CONTRIBUTED_TOKEN_TWO.balanceOf(SELLER);

    assert.equal(
      receipientTokenOneBalanceAfter - receipientTokenOneBalanceBefore,
      expectedRecipientTokenOneBalanceChange
    );
    assert.equal(
      receipientTokenTwoBalanceAfter - receipientTokenTwoBalanceBefore,
      expectedRecipientTokenTwoBalanceChange
    );
  });

  it("contributor should distribute tokens correctly and excess contributions correctly", async function () {
    // test variables
    const expectedContributorSaleTokenBalanceChange = "1000";
    const expectedBuyerOneSaleTokenBalanceChange = "800"; // 80% of total contribution (2000 * 1 + 4000 * 1 + 500 * 4 = 8000)
    const expectedBuyerTwoSaleTokenBalanceChange = "200"; // 20% of total contribution (500 * 4 = 2000)

    // expected refunds from excess contributions
    // 10k contributions - 6k maxRaise = 4k in refunds (multiplier applied)
    const expectedBuyerOneTokenOneRefund = "2400"; // .6 * 4k / 1 (multiplier)
    const expectedBuyerOneTokenTwoRefund = "200"; // .2 * 4k / 4 (multiplier)
    const expectedBuyerTwoTokenTwoRefund = "200"; // .2 * 4k / 4 (multiplier)

    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // check balances before claiming allocations and excess contributions
    const contributorSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
    const buyerOneSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(
      BUYER_ONE
    );
    const buyerTwoSaleTokenBalanceBefore = await SOLD_TOKEN.balanceOf(
      BUYER_TWO
    );

    const buyerOneTokenOneBalanceBefore = await CONTRIBUTED_TOKEN_ONE.balanceOf(
      BUYER_ONE
    );
    const buyerOneTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_ONE
    );
    const buyerTwoTokenTwoBalanceBefore = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

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
    const contributorSaleTokenBalanceAfter = await SOLD_TOKEN.balanceOf(
      TokenSaleContributor.address
    );
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

    // check that excess contributions were distributed correctly
    const buyerOneTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(
      BUYER_ONE
    );
    const buyerOneTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_ONE
    );
    const buyerTwoTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(
      BUYER_TWO
    );

    assert.equal(
      buyerOneTokenOneBalanceAfter - buyerOneTokenOneBalanceBefore,
      expectedBuyerOneTokenOneRefund
    );
    assert.equal(
      buyerOneTokenTwoBalanceAfter - buyerOneTokenTwoBalanceBefore,
      expectedBuyerOneTokenTwoRefund
    );
    assert.equal(
      buyerTwoTokenTwoBalanceAfter - buyerTwoTokenTwoBalanceBefore,
      expectedBuyerTwoTokenTwoRefund
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

  it("conductor should not allow a sale to abort after the sale start time", async function () {
    console.log(
      "\n       -------------------------- Other Tests --------------------------"
    );
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
    const saleId5 = 4;

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      SOLD_TOKEN.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
        tokenTwoConversionRate,
      ],
    ];

    // create a another sale
    await initialized.methods.createSale(saleParams, acceptedTokens).send({
      value: "0",
      from: SELLER,
      gasLimit: GAS_LIMIT,
    });

    // wait for the sale to start
    await wait(6);

    let failed = false;
    try {
      // try to abort abort after the sale started
      await initialized.methods.abortSaleBeforeStartTime(saleId5).send({
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

  it("contributor should not initialize a sale with non-ERC20 tokens", async function () {
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
    const tokenDecimals = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test

    const initializedConductor = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );
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
      tokenDecimals,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      soldToken.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + accounts[0].substr(2), // create bad address
        tokenTwoConversionRate,
      ],
    ];

    // create a another sale
    await initializedConductor.methods
      .createSale(saleParams, acceptedTokens)
      .send({
        value: "0",
        from: SELLER,
        gasLimit: GAS_LIMIT,
      });

    // Grab the message generated by the conductor
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
      assert.equal(
        e.message,
        "Returned error: VM Exception while processing transaction: revert non-existent ERC20"
      );
      failed = true;
    }

    assert.ok(failed);
  });

  it("conductor should only accept tokens with non-zero conversion rates", async function () {
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
    const tokenDecimals = 18;
    const mintAccount = SELLER;
    const tokenSequence = 0; // set to 0 for the test
    const tokenChainId = 0; // set to 0 for the test
    const nativeContractAddress = "0x00"; // set to 0 for the test

    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // create sale token again
    const saleTokenMintAmount = "2000";
    const soldToken = await TokenImplementation.new();
    const soldTokenName = "Sold Token";
    const soldTokenSymbol = "SOLD";

    await soldToken.initialize(
      soldTokenName,
      soldTokenSymbol,
      tokenDecimals,
      tokenSequence,
      mintAccount,
      tokenChainId,
      nativeContractAddress
    );
    await soldToken.mint(SELLER, saleTokenMintAmount);
    await soldToken.approve(TokenSaleConductor.address, saleTokenAmount);

    // create array (solidity struct) for sale params
    const saleParams = [
      soldToken.address,
      saleTokenAmount,
      minimumTokenRaise,
      maximumTokenRaise,
      saleStart,
      saleEnd,
      saleRecipient,
      refundRecipient,
    ];

    // create accepted tokens array
    const acceptedTokens = [
      [
        TEST_CHAIN_ID,
        "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
        tokenOneConversionRate,
      ],
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
        value: "0",
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
});

contract("ICCO Library Upgrade", function (accounts) {
  it("conductor should accept a valid upgrade with library changes", async function () {
    const initialized = new web3.eth.Contract(
      ConductorImplementationFullABI,
      TokenSaleConductor.address
    );

    // deploy mock contracts and link ICCOStructs library
    const structs = await MockICCOStructs.new();
    await MockConductorImplementation2.link(structs, structs.address);
    const mock = await MockConductorImplementation2.new();

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleConductor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(
      before.toLowerCase(),
      ConductorImplementation.address.toLowerCase()
    );

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
    const mockImpl = new web3.eth.Contract(
      MockConductorImplementation2.abi,
      TokenSaleConductor.address
    );

    let isUpgraded = await mockImpl.methods
      .testNewImplementationActive()
      .call();
    let isConductorUpgraded = await mockImpl.methods.upgradeSuccessful().call();

    assert.ok(isUpgraded);
    assert.ok(isConductorUpgraded);

    // call new method in mock ICCO structs to confirm library upgrade was successful
    const mockICCOLib = new web3.eth.Contract(
      MockICCOStructs.abi,
      structs.address
    );

    let isLibraryUpgraded = await mockICCOLib.methods
      .testNewLibraryActive()
      .call();

    assert.ok(isLibraryUpgraded);
  });

  it("contributor should accept a valid upgrade with library changes", async function () {
    const initialized = new web3.eth.Contract(
      ContributorImplementationFullABI,
      TokenSaleContributor.address
    );

    // deploy mock contracts and link ICCOStructs library
    const structs = await MockICCOStructs.new();
    await MockContributorImplementation2.link(structs, structs.address);
    const mock = await MockContributorImplementation2.new();

    // confirm that the implementation address changes
    let before = await web3.eth.getStorageAt(
      TokenSaleContributor.address,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    );

    assert.equal(
      before.toLowerCase(),
      ContributorImplementation.address.toLowerCase()
    );

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
    const mockImpl = new web3.eth.Contract(
      MockContributorImplementation2.abi,
      TokenSaleContributor.address
    );

    let isUpgraded = await mockImpl.methods
      .testNewImplementationActive()
      .call();
    let isContributorUpgraded = await mockImpl.methods
      .upgradeSuccessful()
      .call();

    assert.ok(isUpgraded);
    assert.ok(isContributorUpgraded);

    // call new method in ICCO structs to confirm library upgrade was successful
    const mockICCOLib = new web3.eth.Contract(
      MockICCOStructs.abi,
      structs.address
    );

    let isLibraryUpgraded = await mockICCOLib.methods
      .testNewLibraryActive()
      .call();

    assert.ok(isLibraryUpgraded);
  });
});

const signContribution = async function (
  conductorAddress,
  saleId,
  tokenIndex,
  amount,
  buyerAddress,
  signer
) {
  const body = [
    web3.eth.abi.encodeParameter("bytes32", conductorAddress).substring(2),
    web3.eth.abi.encodeParameter("uint256", saleId).substring(2),
    web3.eth.abi.encodeParameter("uint256", tokenIndex).substring(2),
    web3.eth.abi.encodeParameter("uint256", amount).substring(2),
    web3.eth.abi
      .encodeParameter("address", buyerAddress)
      .substring(2 + (64 - 40)),
  ];

  // compute the hash
  const hash = web3.utils.soliditySha3("0x" + body.join(""));

  const ec = new elliptic.ec("secp256k1");
  const key = ec.keyFromPrivate(signer);
  const signature = key.sign(hash.substr(2), { canonical: true });

  const packSig = [
    zeroPadBytes(signature.r.toString(16), 32),
    zeroPadBytes(signature.s.toString(16), 32),
    web3.eth.abi
      .encodeParameter("uint8", signature.recoveryParam)
      .substr(2 + (64 - 2)),
  ];

  return "0x" + packSig.join("");
};

const signAndEncodeVM = async function (
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
    web3.eth.abi
      .encodeParameter("uint16", emitterChainId)
      .substring(2 + (64 - 4)),
    web3.eth.abi.encodeParameter("bytes32", emitterAddress).substring(2),
    web3.eth.abi.encodeParameter("uint64", sequence).substring(2 + (64 - 16)),
    web3.eth.abi
      .encodeParameter("uint8", consistencyLevel)
      .substring(2 + (64 - 2)),
    data.substr(2),
  ];

  const hash = web3.utils.soliditySha3(
    web3.utils.soliditySha3("0x" + body.join(""))
  );

  let signatures = "";

  for (let i in signers) {
    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPrivate(signers[i]);
    const signature = key.sign(hash.substr(2), { canonical: true });

    const packSig = [
      web3.eth.abi.encodeParameter("uint8", i).substring(2 + (64 - 2)),
      zeroPadBytes(signature.r.toString(16), 32),
      zeroPadBytes(signature.s.toString(16), 32),
      web3.eth.abi
        .encodeParameter("uint8", signature.recoveryParam)
        .substr(2 + (64 - 2)),
    ];

    signatures += packSig.join("");
  }

  const vm = [
    web3.eth.abi.encodeParameter("uint8", 1).substring(2 + (64 - 2)),
    web3.eth.abi
      .encodeParameter("uint32", guardianSetIndex)
      .substring(2 + (64 - 8)),
    web3.eth.abi
      .encodeParameter("uint8", signers.length)
      .substring(2 + (64 - 2)),

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
