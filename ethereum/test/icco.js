const jsonfile = require('jsonfile');
const elliptic = require('elliptic');
const { assert } = require('chai');
const { ethers } = require('ethers');

const Wormhole = artifacts.require("Wormhole");
const TokenBridge = artifacts.require("TokenBridge");
const TokenImplementation = artifacts.require("TokenImplementation");

const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const TokenSaleContributor = artifacts.require("TokenSaleContributor");
const MockConductorImplementation = artifacts.require("MockConductorImplementation");
const MockContributorImplementation = artifacts.require("MockContributorImplementation");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ContributorImplementation = artifacts.require("ContributorImplementation");

const testSigner1PK = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";

const WormholeImplementationFullABI = jsonfile.readFileSync("build/contracts/Implementation.json").abi
const ConductorImplementationFullABI = jsonfile.readFileSync("build/contracts/ConductorImplementation.json").abi
const ContributorImplementationFullABI = jsonfile.readFileSync("build/contracts/ContributorImplementation.json").abi


contract("ICCO", function (accounts) {
    const TEST_CHAIN_ID = "2";
    const TEST_GOVERNANCE_CHAIN_ID = "1";
    const TEST_GOVERNANCE_CONTRACT = "0x0000000000000000000000000000000000000000000000000000000000000004";
    const GAS_LIMIT = "2000000";

    const WORMHOLE = new web3.eth.Contract(WormholeImplementationFullABI, Wormhole.address);
    
    it("conductor should be initialized with the correct values", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // chain id
        const chainId = await initialized.methods.chainId().call();
        assert.equal(chainId, TEST_CHAIN_ID);

        // wormhole
        const WORMHOLE = await initialized.methods.wormhole().call();
        assert.equal(WORMHOLE, Wormhole.address);

        // tokenBridge
        const tokenbridge = await initialized.methods.tokenBridge().call();
        assert.equal(tokenbridge, TokenBridge.address);

        // governance
        const governanceChainId = await initialized.methods.governanceChainId().call();
        assert.equal(governanceChainId, TEST_GOVERNANCE_CHAIN_ID);
        const governanceContract = await initialized.methods.governanceContract().call();
        assert.equal(governanceContract, TEST_GOVERNANCE_CONTRACT);
    })

    it("contributor should be initialized with the correct values", async function () {
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
        assert.equal(WORMHOLE, (await Wormhole.deployed()).address);

        // tokenBridge
        const tokenbridge = await initialized.methods.tokenBridge().call();
        assert.equal(tokenbridge, (await TokenBridge.deployed()).address);

        // governance
        const governanceChainId = await initialized.methods.governanceChainId().call();
        assert.equal(governanceChainId, TEST_GOVERNANCE_CHAIN_ID);
        const governanceContract = await initialized.methods.governanceContract().call();
        assert.equal(governanceContract, TEST_GOVERNANCE_CONTRACT);
    })

    it("conductor should register a contributor implementation correctly", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        let data = [
            "0x",
            "0000000000000000000000000000000000000000000000546f6b656e53616c65",
            "01",
            "0000",
            web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("bytes32", "0x000000000000000000000000" + TokenSaleContributor.address.substr(2)).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_GOVERNANCE_CHAIN_ID,
            TEST_GOVERNANCE_CONTRACT,
            0,
            data,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let before = await initialized.methods.contributorContracts(TEST_CHAIN_ID).call();

        assert.equal(before, "0x0000000000000000000000000000000000000000000000000000000000000000");

        await initialized.methods.registerChain("0x" + vm).send({
            value: 0,
            from: accounts[0],
            gasLimit: GAS_LIMIT
        });

        let after = await initialized.methods.contributorContracts(TEST_CHAIN_ID).call();

        assert.equal(after.substr(26).toLowerCase(), TokenSaleContributor.address.substr(2).toLowerCase());
    })

    it("conductor should accept a valid upgrade", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const mock = await MockConductorImplementation.new();

        let data = [
            "0x",
            "0000000000000000000000000000000000000000000000546f6b656e53616c65",
            "02",
            web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("address", mock.address).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_GOVERNANCE_CHAIN_ID,
            TEST_GOVERNANCE_CONTRACT,
            0,
            data,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let before = await web3.eth.getStorageAt(TokenSaleConductor.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        assert.equal(before.toLowerCase(), ConductorImplementation.address.toLowerCase());

        await initialized.methods.upgrade("0x" + vm).send({
            value: 0,
            from: accounts[0],
            gasLimit: GAS_LIMIT
        });

        let after = await web3.eth.getStorageAt(TokenSaleConductor.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        assert.equal(after.toLowerCase(), mock.address.toLowerCase());

        const mockImpl = new web3.eth.Contract(MockConductorImplementation.abi, TokenSaleConductor.address);

        let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();

        assert.ok(isUpgraded);
    })

    it("contributor should accept a valid upgrade", async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const mock = await MockContributorImplementation.new();

        let data = [
            "0x",
            "0000000000000000000000000000000000000000000000546f6b656e53616c65",
            "03",
            web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("address", mock.address).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_GOVERNANCE_CHAIN_ID,
            TEST_GOVERNANCE_CONTRACT,
            0,
            data,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let before = await web3.eth.getStorageAt(TokenSaleContributor.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        assert.equal(before.toLowerCase(), ContributorImplementation.address.toLowerCase());

        await initialized.methods.upgrade("0x" + vm).send({
            value: 0,
            from: accounts[0],
            gasLimit: GAS_LIMIT
        });

        let after = await web3.eth.getStorageAt(TokenSaleContributor.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        assert.equal(after.toLowerCase(), mock.address.toLowerCase());

        const mockImpl = new web3.eth.Contract(MockContributorImplementation.abi, TokenSaleContributor.address);

        let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();

        assert.ok(isUpgraded);
    })

    // global sale test variables
    let SOLD_TOKEN;
    let CONTRIBUTED_TOKEN_ONE;
    let CONTRIBUTED_TOKEN_TWO;
    const SELLER = accounts[0];
    const BUYER_ONE = accounts[1];
    const BUYER_TWO = accounts[2];

    it('mint one token to sell, two to buy', async function () {
        // test variables
        const tokenDecimals = 18;
        const mintAccount = accounts[0];
        const tokenSequence = 0; // set to 0 for the test
        const tokenChainId = 0; // set to 0 for the test
        const nativeContractAddress = "0x00"; // set to 0 for the test

        // token amounts to mint
        const saleTokenMintAmount = "2000";
        const contributedTokensMintAmount = "20000";
        
        // token to sell in ICCO
        SOLD_TOKEN = await TokenImplementation.new()
        const soldTokenName = "Sold Token";
        const soldTokenSymbol = "SOLD"
        
        await SOLD_TOKEN.initialize(
            soldTokenName,
            soldTokenSymbol,
            tokenDecimals,
            tokenSequence,
            mintAccount,
            tokenChainId,
            nativeContractAddress
        );
        await SOLD_TOKEN.mint(SELLER, saleTokenMintAmount)

        // first token to contribute in sale
        CONTRIBUTED_TOKEN_ONE = await TokenImplementation.new()
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
        await CONTRIBUTED_TOKEN_ONE.mint(BUYER_ONE, contributedTokensMintAmount)

        // second token to contribute to sale
        CONTRIBUTED_TOKEN_TWO = await TokenImplementation.new()
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
        await CONTRIBUTED_TOKEN_TWO.mint(BUYER_TWO, contributedTokensMintAmount)
    })

    // more global sale test variables
    let SALE_START;
    let SALE_END;
    let SALE_INIT_PAYLOAD;  
    let SALE_ID = 0;
    let TOKEN_ONE_INDEX = 0;
    let TOKEN_TWO_INDEX = 1;

    it('create a sale correctly and attest over wormhole', async function () {
        // test variables
        const current_block = await web3.eth.getBlock('latest');
        SALE_START = current_block.timestamp + 5;
        SALE_END = SALE_START + 8;

        const saleTokenAmount = "1000";
        const minimumTokenRaise = "2000";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoConversionRate = "2000000000000000000";
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];
        const acceptedTokenLength = 2;
        const payloadIdType1 = "01";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount);

        // create accepted tokens array
        const acceptedTokens = [
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
                tokenOneConversionRate 
            ],
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
                tokenTwoConversionRate
            ]
        ]

        // create the sale
        let tx = await initialized.methods.createSale(
            SOLD_TOKEN.address,
            saleTokenAmount,
            minimumTokenRaise,
            SALE_START,
            SALE_END,
            acceptedTokens,
            saleRecipient,
            refundRecipient
        ).send({
            value : "0",
            from : SELLER,
            gasLimit : GAS_LIMIT
        })   

        // Verify Payload sent to contributor
        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        // verify payload 
        assert.equal(log.sender, TokenSaleConductor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType1)
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // token amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(saleTokenAmount));
        index += 64

        // min raise amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(minimumTokenRaise));
        index += 64

        // timestamp start
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_START);
        index += 64

        // timestamp end
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_END);
        index += 64

        // accepted tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
        index += 2

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenOneConversionRate));
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenTwoConversionRate));
        index += 64

        // recipient of proceeds
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        index += 64

        // refund recipient in case the sale is aborted
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        index += 64

        assert.equal(log.payload.length, index)
        SALE_INIT_PAYLOAD = log.payload.toString()

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_ID).call()

        assert.equal(sale.saleID, SALE_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
        assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
        assert.equal(sale.saleStart, SALE_START);
        assert.equal(sale.saleEnd, SALE_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], parseInt(tokenOneConversionRate));
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], parseInt(tokenTwoConversionRate));
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(!sale.refundIsClaimed);

        // verify that getNextSaleId is correct
        const nextSaleId = await initialized.methods.getNextSaleId().call()

        assert.equal(nextSaleId, SALE_ID + 1)
    })
     
    it('should init a sale in the contributor', async function () {
        // test variables 
        const saleTokenAmount = "1000";
        const minimumTokenRaise = "2000";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoConversionRate = "2000000000000000000";
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // initialize the sale
        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_INIT_PAYLOAD,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let tx = await initialized.methods.initSale("0x"+vm).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_ID).call()

        assert.equal(sale.saleID, SALE_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
        assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
        assert.equal(sale.saleStart, SALE_START);
        assert.equal(sale.saleEnd, SALE_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], parseInt(tokenOneConversionRate));
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], parseInt(tokenTwoConversionRate));
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(sale.allocations[TOKEN_ONE_INDEX], 0);
        assert.ok(sale.allocations[TOKEN_TWO_INDEX], 0) 

        // verify getsaleAcceptedTokenInfo getter
        const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_ID, TOKEN_ONE_INDEX).call();
        const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_ID, TOKEN_TWO_INDEX).call();
        
        assert.equal(tokenOneInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenOneInfo.conversionRate, parseInt(tokenOneConversionRate));
        assert.equal(tokenTwoInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenTwoInfo.conversionRate, parseInt(tokenTwoConversionRate));

        // verify getSaleTimeFrame getter
        const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_ID).call();

        assert.equal(saleTimeframe.start, SALE_START);
        assert.equal(saleTimeframe.end, SALE_END);

        // verify getSaleStatus getter
        const saleStatus = await initialized.methods.getSaleStatus(SALE_ID).call();
    
        assert.ok(!saleStatus.isSealed);
        assert.ok(!saleStatus.isAborted);
    })  
    
    it('should accept contributions in the contributor during the sale timeframe', async function () {
        await advanceTimeAndBlock(5);

        // test variables
        const tokenOneContributionAmount = "10000";
        const tokenTwoContributionAmount = "5000";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
            from:BUYER_ONE
        })
        await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount, {
            from:BUYER_TWO
        })   

        // contribute tokens to the sale
        let tx = await initialized.methods.contribute(SALE_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount)).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        let tx2 = await initialized.methods.contribute(SALE_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount)).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        // verify getSaleTotalContribution after contributing
        const totalContributionsTokenOne = await initialized.methods.getSaleTotalContribution(SALE_ID, TOKEN_ONE_INDEX).call();
        const totalContributionsTokenTwo = await initialized.methods.getSaleTotalContribution(SALE_ID, TOKEN_TWO_INDEX).call();

        assert.equal(totalContributionsTokenOne, parseInt(tokenOneContributionAmount));
        assert.equal(totalContributionsTokenTwo, parseInt(tokenTwoContributionAmount));

        // verify getSaleContribution
        const buyerOneContribution = await initialized.methods.getSaleContribution(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoContribution = await initialized.methods.getSaleContribution(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

        assert.equal(buyerOneContribution, parseInt(tokenOneContributionAmount));
        assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount));
    }) 
     
    it('should not accept contributions after the sale has ended', async function () {
        await advanceTimeAndBlock(10);

        // test variables
        const tokenTwoContributionAmount = 5000;

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);
 
        let failed = false
        try {
            await initialized.methods.contribute(SALE_ID, TOKEN_TWO_INDEX, tokenTwoContributionAmount).send({
                from : BUYER_TWO,
                gasLimit : GAS_LIMIT
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale has ended")
            failed = true
        }

        assert.ok(failed)
    })
    
    let CONTRIBUTIONS_PAYLOAD;

    it('should attest contributions correctly', async function () {
        // test variables
        const tokenOneContributionAmount = 10000;
        const tokenTwoContributionAmount = 5000;
        const acceptedTokenLength = 2;
        const payloadIdType2 = "02";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // attest contributions 
        let tx = await initialized.methods.attestContributions(SALE_ID).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleContributor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType2)
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
        index += 64

        // chain id
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4))
        index += 4

        // tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
        index += 2

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", TOKEN_ONE_INDEX).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenOneContributionAmount);
        index += 64

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", TOKEN_TWO_INDEX).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenTwoContributionAmount);
        index += 64

        assert.equal(log.payload.length, index);
        CONTRIBUTIONS_PAYLOAD = log.payload.toString()
    })
    
    it('conductor should collect contributions correctly', async function () {
        // test variables
        const tokenOneContributionAmount = 10000;
        const tokenTwoContributionAmount = 5000;

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // verify saleContributionIsCollected getter before collecting contributions
        const isContributionOneCollectedBefore = await initialized.methods.saleContributionIsCollected(SALE_ID, TOKEN_ONE_INDEX).call();
        const isContributionTwoCollectedBefore = await initialized.methods.saleContributionIsCollected(SALE_ID, TOKEN_TWO_INDEX).call();

        assert.ok(!isContributionOneCollectedBefore);
        assert.ok(!isContributionTwoCollectedBefore);

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleContributor.address.substr(2),
            0,
            CONTRIBUTIONS_PAYLOAD,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let tx = await initialized.methods.collectContribution("0x"+vm).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // verify saleContributionIsCollected getter after collecting contributions
        const isContributionOneCollectedAfter = await initialized.methods.saleContributionIsCollected(SALE_ID, TOKEN_ONE_INDEX).call();
        const isContributionTwoCollectedAfter = await initialized.methods.saleContributionIsCollected(SALE_ID, TOKEN_TWO_INDEX).call();

        assert.ok(isContributionOneCollectedAfter);
        assert.ok(isContributionTwoCollectedAfter);

        // verify saleContributions getter
        const contributions = await initialized.methods.saleContributions(SALE_ID).call();

        assert.equal(contributions[0], tokenOneContributionAmount);
        assert.equal(contributions[1], tokenTwoContributionAmount);
    })
    
    let SALE_SEALED_PAYLOAD;

    it('conductor should seal the sale correctly and distribute tokens', async function () {
        // test variables
        const expectedContributorBalanceBefore = "0";
        const expectedConductorBalanceBefore = "1000";
        const expectedContributorBalanceAfter = "1000";
        const expectedConductorBalanceAfter = "0";
        const payloadIdType3 = "03";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

        assert.equal(actualContributorBalanceBefore, expectedContributorBalanceBefore);
        assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);

        // verify sealSealed flag in sales
        const saleBefore = await initialized.methods.sales(SALE_ID).call();

        assert.ok(!saleBefore.isSealed);

        // seal the sale
        let tx = await initialized.methods.sealSale(0).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        });

        const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

        assert.equal(actualContributorBalanceAfter, expectedContributorBalanceAfter);
        assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues;

        // verify saleSealed payload
        assert.equal(log.sender, TokenSaleConductor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType3)
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_ID);
        index += 64
        SALE_SEALED_PAYLOAD = log.payload;

        // verify saleSealed flag after sealing the sale
        const saleAfter = await initialized.methods.sales(SALE_ID).call();

        assert.ok(saleAfter.isSealed);
    })
    
    it('contributor should seal a sale correctly', async function () {
        // test variables
        const expectedAllocationTokenOne = "500";
        const expectedAllocationTokenTwo = "500";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // verify sealSealed getters before calling saleSealed
        const saleBefore = await initialized.methods.sales(SALE_ID).call();

        // verify isSealed flag before
        assert.ok(!saleBefore.isSealed);

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_SEALED_PAYLOAD,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // seal the sale
        let tx = await initialized.methods.saleSealed("0x"+vm).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        // confirm that the sale was sealed
        const saleAfter = await initialized.methods.sales(SALE_ID).call();
        
        assert.ok(saleAfter.isSealed);

        // verify getSaleAllocation after sealing the sale
        const actualAllocationTokenOne = await initialized.methods.getSaleAllocation(SALE_ID, TOKEN_ONE_INDEX).call();
        const actualAllocationTokenTwo = await initialized.methods.getSaleAllocation(SALE_ID, TOKEN_TWO_INDEX).call();

        assert.equal(actualAllocationTokenOne, expectedAllocationTokenOne);
        assert.equal(actualAllocationTokenTwo, expectedAllocationTokenTwo);
    })
    
    let ONE_CLAIM_SNAPSHOT;

    it('contributor should distribute tokens correctly', async function () {
        // test variables 
        const expectedContributorBalanceBefore = "1000";
        const expectedBuyerOneBalanceBefore = "0";
        const expectedBuyerTwoBalanceBefore = "0";
        const expectedContributorBalanceAfter = "0";
        const expectedBuyerOneBalanceAfter = "500";
        const expectedBuyerTwoBalanceAfter = "500";
        
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // check balances before claiming allocations
        const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualBuyerOneBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_ONE);
        const actualBuyerTwoBalanceBefore = await SOLD_TOKEN.balanceOf(BUYER_TWO);

        assert.equal(actualContributorBalanceBefore, expectedContributorBalanceBefore);
        assert.equal(actualBuyerOneBalanceBefore, expectedBuyerOneBalanceBefore);
        assert.equal(actualBuyerTwoBalanceBefore, expectedBuyerTwoBalanceBefore);

        // verify allocationIsClaimed before claiming allocation
        const isAllocationClaimedTokenOneBefore = await initialized.methods.allocationIsClaimed(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const isAllocationClaimedTokenTwoBefore = await initialized.methods.allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();
        
        assert.ok(!isAllocationClaimedTokenOneBefore);
        assert.ok(!isAllocationClaimedTokenTwoBefore);

        // claim allocations for both tokens
        await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        ONE_CLAIM_SNAPSHOT = await snapshot()

        await initialized.methods.claimAllocation(SALE_ID, TOKEN_ONE_INDEX).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        // check balances after claiming allocations
        const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualBuyerOneBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_ONE);
        const actualBuyerTwoBalanceAfter = await SOLD_TOKEN.balanceOf(BUYER_TWO);

        assert.equal(actualContributorBalanceAfter, expectedContributorBalanceAfter);
        assert.equal(actualBuyerOneBalanceAfter, expectedBuyerOneBalanceAfter);
        assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

        // verify allocationIsClaimed after claiming allocation
        const isAllocationClaimedTokenOneAfter = await initialized.methods.allocationIsClaimed(SALE_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const isAllocationClaimedTokenTwoAfter = await initialized.methods.allocationIsClaimed(SALE_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();
        
        assert.ok(isAllocationClaimedTokenOneAfter);
        assert.ok(isAllocationClaimedTokenTwoAfter);
    })
    
    it('allocation should only be claimable once', async function () {
        await revert(ONE_CLAIM_SNAPSHOT)

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        let failed = false
        try {
            await initialized.methods.claimAllocation(SALE_ID, TOKEN_TWO_INDEX).send({
                from : BUYER_TWO,
                gasLimit : GAS_LIMIT
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert allocation already claimed")
            failed = true
        }

        assert.ok(failed)
    })
     
    let SALE_2_START;
    let SALE_2_END;
    let SALE_2_INIT_PAYLOAD;
    let SALE_2_ID;

    it('create a second sale correctly and attest over wormhole', async function () {
        // test variables
        const current_block = await web3.eth.getBlock('latest');
        SALE_2_START = current_block.timestamp + 5;
        SALE_2_END = SALE_2_START + 8;
        const saleTokenAmount = "1000";
        const minimumTokenRaise = "2000";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoConversionRate = "2000000000000000000";
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];
        const acceptedTokenLength = 2;
        const payloadIdType1 = "01";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount)

        // create accepted tokens array 
        const acceptedTokens = [
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
                tokenOneConversionRate
            ],
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
                tokenTwoConversionRate
            ]
        ]

        // create a second sale
        let tx = await initialized.methods.createSale(
            SOLD_TOKEN.address,
            saleTokenAmount,
            minimumTokenRaise,
            SALE_2_START,
            SALE_2_END,
            acceptedTokens,
            saleRecipient,
            refundRecipient
        ).send({
            value : "0",
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleConductor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType1)
        index += 2

        // sale id, should == 1 since it's the second sale
        SALE_2_ID = 1;
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_ID); 
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // token amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(saleTokenAmount));
        index += 64

        // min raise amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(minimumTokenRaise));
        index += 64

        // timestamp start
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_START);
        index += 64

        // timestamp end
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_END);
        index += 64

        // accepted tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
        index += 2

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenOneConversionRate));
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenTwoConversionRate));
        index += 64

        // recipient of proceeds
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        index += 64

        // refund recipient in case the sale is aborted
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        index += 64

        assert.equal(log.payload.length, index)
        SALE_2_INIT_PAYLOAD = log.payload.toString()

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_2_ID).call()

        assert.equal(sale.saleID, SALE_2_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
        assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
        assert.equal(sale.saleStart, SALE_2_START);
        assert.equal(sale.saleEnd, SALE_2_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], parseInt(tokenOneConversionRate));
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], parseInt(tokenTwoConversionRate));
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(!sale.refundIsClaimed);

        // verify that getNextSaleId is correct
        const nextSaleId = await initialized.methods.getNextSaleId().call()

        assert.equal(nextSaleId, SALE_2_ID + 1)
    })
    
    it('should init a second sale in the contributor', async function () {
        // test variables
        const saleTokenAmount = 1000;
        const minimumTokenRaise = 2000;
        const tokenOneConversionRate = 1000000000000000000;
        const tokenTwoConversionRate = 2000000000000000000;
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_2_INIT_PAYLOAD,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // initialize the second sale
        let tx = await initialized.methods.initSale("0x"+vm).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_2_ID).call()

        assert.equal(sale.saleID, SALE_2_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, saleTokenAmount);
        assert.equal(sale.minRaise, minimumTokenRaise);
        assert.equal(sale.saleStart, SALE_2_START);
        assert.equal(sale.saleEnd, SALE_2_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], tokenOneConversionRate);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], tokenTwoConversionRate);
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(sale.allocations[TOKEN_ONE_INDEX], 0);
        assert.ok(sale.allocations[TOKEN_TWO_INDEX], 0) 

        // verify getsaleAcceptedTokenInfo getter
        const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_ONE_INDEX).call();
        const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_2_ID, TOKEN_TWO_INDEX).call();
        
        assert.equal(tokenOneInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
        assert.equal(tokenTwoInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

        // verify getSaleTimeFrame getter
        const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_2_ID).call();

        assert.equal(saleTimeframe.start, SALE_2_START);
        assert.equal(saleTimeframe.end, SALE_2_END);

        // verify getSaleStatus getter
        const saleStatus = await initialized.methods.getSaleStatus(SALE_2_ID).call();
    
        assert.ok(!saleStatus.isSealed);
        assert.ok(!saleStatus.isAborted);
    })
    
    it('should accept contributions in the contributor during the second sale timeframe', async function () {
        await advanceTimeAndBlock(5);

        // test variables
        const tokenOneContributionAmount = "1000";
        const tokenTwoContributionAmount = "250";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
            from:BUYER_ONE
        })
        await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount, {
            from:BUYER_TWO
        })   

        // contribute tokens to the sale
        let tx = await initialized.methods.contribute(SALE_2_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount)).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        let tx2 = await initialized.methods.contribute(SALE_2_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount)).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        // verify getSaleTotalContribution before contributing
        const totalContributionsTokenOne = await initialized.methods.getSaleTotalContribution(SALE_2_ID, TOKEN_ONE_INDEX).call();
        const totalContributionsTokenTwo = await initialized.methods.getSaleTotalContribution(SALE_2_ID, TOKEN_TWO_INDEX).call();

        assert.equal(totalContributionsTokenOne, parseInt(tokenOneContributionAmount));
        assert.equal(totalContributionsTokenTwo, parseInt(tokenTwoContributionAmount));

        // verify getSaleContribution
        const buyerOneContribution = await initialized.methods.getSaleContribution(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoContribution = await initialized.methods.getSaleContribution(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

        assert.equal(buyerOneContribution, parseInt(tokenOneContributionAmount));
        assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount));
    })
    
    let CONTRIBUTIONS_PAYLOAD_2;

    it('should attest contributions for second sale correctly', async function () {
        await advanceTimeAndBlock(10);

        // test variables
        const tokenOneContributionAmount = 1000;
        const tokenTwoContributionAmount = 250;
        const acceptedTokenLength = 2;
        const payloadIdType2 = "02";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // attest contributions
        let tx = await initialized.methods.attestContributions(SALE_2_ID).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleContributor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType2)
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_2_ID);
        index += 64

        // chain id
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4))
        index += 4

        // tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
        index += 2

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenOneContributionAmount);
        index += 64

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), tokenTwoContributionAmount);
        index += 64

        assert.equal(log.payload.length, index);

        CONTRIBUTIONS_PAYLOAD_2 = log.payload.toString()
    })
    
    it('conductor should collect second sale contributions correctly', async function () {
        // test variables
        const tokenOneContributionAmount = 1000;
        const tokenTwoContributionAmount = 250;

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // verify saleContributionIsCollected getter before calling contribute
        const isContributionOneCollectedBefore = await initialized.methods.saleContributionIsCollected(SALE_2_ID, TOKEN_ONE_INDEX).call();
        const isContributionTwoCollectedBefore = await initialized.methods.saleContributionIsCollected(SALE_2_ID, TOKEN_TWO_INDEX).call();

        assert.ok(!isContributionOneCollectedBefore);
        assert.ok(!isContributionTwoCollectedBefore);

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleContributor.address.substr(2),
            0,
            CONTRIBUTIONS_PAYLOAD_2,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // collect the contributions
        let tx = await initialized.methods.collectContribution("0x"+vm).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // verify saleContributionIsCollected getter after calling contribute
        const isContributionOneCollectedAfter = await initialized.methods.saleContributionIsCollected(SALE_2_ID, TOKEN_ONE_INDEX).call();
        const isContributionTwoCollectedAfter = await initialized.methods.saleContributionIsCollected(SALE_2_ID, TOKEN_TWO_INDEX).call();

        assert.ok(isContributionOneCollectedAfter);
        assert.ok(isContributionTwoCollectedAfter);

        // verify saleContributions getter
        const contributions = await initialized.methods.saleContributions(SALE_2_ID).call();

        assert.equal(contributions[0], tokenOneContributionAmount);
        assert.equal(contributions[1], tokenTwoContributionAmount);
    })
    
    let SALE_SEALED_PAYLOAD_2;

    it('conductor should abort the second sale correctly', async function () {
        // test variables
        const expectedContributorBalance = "500";
        const expectedConductorBalance = "1000";
        const payloadIdType4 = "04";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const actualContributorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

        // confirm that the sale is not aborted yet
        const saleBefore = await initialized.methods.sales(SALE_2_ID).call();

        assert.ok(!saleBefore.isAborted);

        // contributor balance is 500 before because of the reverted transaction 
        // in "allocation should only be claimable once"
        assert.equal(actualContributorBalanceBefore, expectedContributorBalance);
        assert.equal(actualConductorBalanceBefore, expectedConductorBalance);

        let tx = await initialized.methods.sealSale(SALE_2_ID).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        });

        const actualContributorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleContributor.address);
        const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);

        // make sure balances haven't changed
        assert.equal(actualContributorBalanceAfter, expectedContributorBalance);
        assert.equal(actualConductorBalanceAfter, expectedConductorBalance);

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues;

        // verify sale sealed payload
        SALE_SEALED_PAYLOAD_2 = log.payload;

        // payload id
        let index = 2
        assert.equal(SALE_SEALED_PAYLOAD_2.substr(index, 2), payloadIdType4);
        index += 2

        // sale id
        assert.equal(parseInt(SALE_SEALED_PAYLOAD_2.substr(index, 64), 16), SALE_2_ID);
        index += 64

        // confirm that the sale is aborted
        const saleAfter = await initialized.methods.sales(SALE_2_ID).call();

        assert.ok(saleAfter.isAborted);
    })
    
    it('contributor should abort second sale correctly', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // verify getSaleStatus before aborting in contributor
        const statusBefore = await initialized.methods.getSaleStatus(SALE_2_ID).call();

        assert.ok(!statusBefore.isAborted)
        assert.ok(!statusBefore.isSealed)

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_SEALED_PAYLOAD_2,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // abort the sale
        let tx = await initialized.methods.saleAborted("0x"+vm).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        // confirm that saleAborted was set to true
        const statusAfter = await initialized.methods.getSaleStatus(SALE_2_ID).call();

        assert.ok(statusAfter.isAborted)
        assert.ok(!statusAfter.isSealed)
    })
    
    it('conductor should distribute refund to refundRecipient correctly', async function () {
        // test variables
        const expectedConductorBalanceBefore = "1000";
        const expectedSellerBalanceBefore = "0";
        const expectedConductorBalanceAfter = "0";
        const expectedSellerBalanceAfter = "1000";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // confirm that refundIsClaimed is false
        const saleBefore = await initialized.methods.sales(SALE_2_ID).call();

        assert.ok(!saleBefore.refundIsClaimed);

        // check starting balances 
        const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
        const actualSellerBalanceBefore = await SOLD_TOKEN.balanceOf(SELLER);

        assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);
        assert.equal(actualSellerBalanceBefore, expectedSellerBalanceBefore);

        // claim the sale token refund
        await initialized.methods.claimRefund(SALE_2_ID).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        });

        // make sure new balances are correct
        const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
        const actualSellerBalanceAfter = await SOLD_TOKEN.balanceOf(SELLER);

        assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);
        assert.equal(actualSellerBalanceAfter, expectedSellerBalanceAfter);

        // confirm that refundClaimed was set to true 
        const saleAfter = await initialized.methods.sales(SALE_2_ID).call();

        assert.ok(saleAfter.refundIsClaimed);
    })
    
    let ONE_REFUND_SNAPSHOT;   

    it('contributor should distribute refunds to contributors correctly', async function () {
        // test variables
        const expectedContributorTokenOneBalanceBefore = "1000";
        const expectedContributorTokenTwoBalanceBefore = "250";  
        const expectedBuyerOneBalanceBefore = "9000";
        const expectedBuyerTwoBalanceBefore = "14750";
        const expectedContributorTokenOneBalanceAfter = "0";
        const excpectedContributorTokenTwoBalanceAfter = "0";  
        const expectedBuyerOneBalanceAfter = "10000";
        const expectedBuyerTwoBalanceAfter = "15000";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // confirm refundIsClaimed is set to false
        const buyerOneHasClaimedRefundBefore = await initialized.methods.refundIsClaimed(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoHasClaimedRefundBefore = await initialized.methods.refundIsClaimed(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

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
        await initialized.methods.claimRefund(SALE_2_ID, TOKEN_ONE_INDEX).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        // snapshot to test trying to claim refund 2x
        ONE_REFUND_SNAPSHOT = await snapshot()

        await initialized.methods.claimRefund(SALE_2_ID, TOKEN_TWO_INDEX).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        // check balances of contributed tokens for buyers and the contributor 
        const actualContributorTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
        const actualContributorTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);        
        const actualBuyerOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
        const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

        assert.equal(actualContributorTokenOneBalanceAfter, expectedContributorTokenOneBalanceAfter);
        assert.equal(actualContributorTokenTwoBalanceAfter, excpectedContributorTokenTwoBalanceAfter);
        assert.equal(actualBuyerOneBalanceAfter, expectedBuyerOneBalanceAfter);
        assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

        // confirm refundIsClaimed is set to true
        const buyerOneHasClaimedRefundAfter = await initialized.methods.refundIsClaimed(SALE_2_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoHasClaimedRefundAfter = await initialized.methods.refundIsClaimed(SALE_2_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

        assert.ok(buyerOneHasClaimedRefundAfter);
        assert.ok(buyerTwoHasClaimedRefundAfter);
    })
    
    it('refund should only be claimable once in contributor', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        await revert(ONE_REFUND_SNAPSHOT)

        let failed = false
        try {
            await initialized.methods.claimRefund(SALE_2_ID, TOKEN_ONE_INDEX).send({
                from : BUYER_ONE,
                gasLimit : GAS_LIMIT
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert refund already claimed")
            failed = true
        }

        assert.ok(failed)
    })

     it('refund should only be claimable once in conductor', async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        let failed = false
        try {
            // claim the sale token refund
            await initialized.methods.claimRefund(SALE_2_ID).send({
                from : SELLER,
                gasLimit : GAS_LIMIT
            });
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert already claimed")
            failed = true
        }

        assert.ok(failed)
    })

    let SALE_3_START;
    let SALE_3_END;
    let SALE_3_INIT_PAYLOAD;
    let SALE_3_ID;

    it('create a third sale correctly and attest over wormhole', async function () {
        // test variables
        const current_block = await web3.eth.getBlock('latest');
        SALE_3_START = current_block.timestamp + 5;
        SALE_3_END = SALE_3_START + 8;
        const saleTokenAmount = "1000";
        const minimumTokenRaise = "2000";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoConversionRate = "2000000000000000000";
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];
        const acceptedTokenLength = 2;
        const payloadIdType1 = "01";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount)

        // create accepted tokens array 
        const acceptedTokens = [
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
                tokenOneConversionRate
            ],
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
                tokenTwoConversionRate
            ]
        ]

        // create a second sale
        let tx = await initialized.methods.createSale(
            SOLD_TOKEN.address,
            saleTokenAmount,
            minimumTokenRaise,
            SALE_3_START,
            SALE_3_END,
            acceptedTokens,
            saleRecipient,
            refundRecipient
        ).send({
            value : "0",
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleConductor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), payloadIdType1)
        index += 2

        // sale id, should == 1 since it's the second sale
        SALE_3_ID = 2;
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_ID); 
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // token amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(saleTokenAmount));
        index += 64

        // min raise amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(minimumTokenRaise));
        index += 64

        // timestamp start
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_START);
        index += 64

        // timestamp end
        assert.equal(parseInt(log.payload.substr(index, 64), 16), SALE_3_END);
        index += 64

        // accepted tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), acceptedTokenLength);
        index += 2

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenOneConversionRate));
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", TEST_CHAIN_ID).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), parseInt(tokenTwoConversionRate));
        index += 64

        // recipient of proceeds
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        index += 64

        // refund recipient in case the sale is aborted
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        index += 64

        assert.equal(log.payload.length, index)
        SALE_3_INIT_PAYLOAD = log.payload.toString()

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_3_ID).call()

        assert.equal(sale.saleID, SALE_3_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, parseInt(saleTokenAmount));
        assert.equal(sale.minRaise, parseInt(minimumTokenRaise));
        assert.equal(sale.saleStart, SALE_3_START);
        assert.equal(sale.saleEnd, SALE_3_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], parseInt(tokenOneConversionRate));
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], parseInt(tokenTwoConversionRate));
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(!sale.refundIsClaimed);

        // verify that getNextSaleId is correct
        const nextSaleId = await initialized.methods.getNextSaleId().call()

        assert.equal(nextSaleId, SALE_3_ID + 1)
    })
    
    it('should init a third sale in the contributor', async function () {
        // test variables
        const saleTokenAmount = 1000;
        const minimumTokenRaise = 2000;
        const tokenOneConversionRate = 1000000000000000000;
        const tokenTwoConversionRate = 2000000000000000000;
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_3_INIT_PAYLOAD,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // initialize the second sale
        let tx = await initialized.methods.initSale("0x"+vm).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // verify sale getter
        const sale = await initialized.methods.sales(SALE_3_ID).call()

        assert.equal(sale.saleID, SALE_3_ID);
        assert.equal(sale.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", SOLD_TOKEN.address).substring(2));
        assert.equal(sale.tokenChain, TEST_CHAIN_ID);
        assert.equal(sale.tokenAmount, saleTokenAmount);
        assert.equal(sale.minRaise, minimumTokenRaise);
        assert.equal(sale.saleStart, SALE_3_START);
        assert.equal(sale.saleEnd, SALE_3_END);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_ONE_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_ONE_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_ONE_INDEX], tokenOneConversionRate);
        assert.equal(sale.acceptedTokensAddresses[TOKEN_TWO_INDEX].substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(sale.acceptedTokensChains[TOKEN_TWO_INDEX], TEST_CHAIN_ID);
        assert.equal(sale.acceptedTokensConversionRates[TOKEN_TWO_INDEX], tokenTwoConversionRate);
        assert.equal(sale.recipient.substring(2), web3.eth.abi.encodeParameter("address", saleRecipient).substring(2));
        assert.equal(sale.refundRecipient.substring(2), web3.eth.abi.encodeParameter("address", refundRecipient).substring(2));
        assert.ok(!sale.isSealed);
        assert.ok(!sale.isAborted);
        assert.ok(sale.allocations[TOKEN_ONE_INDEX], 0);
        assert.ok(sale.allocations[TOKEN_TWO_INDEX], 0) 

        // verify getsaleAcceptedTokenInfo getter
        const tokenOneInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_ONE_INDEX).call();
        const tokenTwoInfo = await initialized.methods.getSaleAcceptedTokenInfo(SALE_3_ID, TOKEN_TWO_INDEX).call();
        
        assert.equal(tokenOneInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_ONE.address).substring(2));
        assert.equal(tokenOneInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);
        assert.equal(tokenTwoInfo.tokenAddress.substring(2), web3.eth.abi.encodeParameter("address", CONTRIBUTED_TOKEN_TWO.address).substring(2));
        assert.equal(tokenTwoInfo.tokenChainId, TEST_CHAIN_ID);
        assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

        // verify getSaleTimeFrame getter
        const saleTimeframe = await initialized.methods.getSaleTimeframe(SALE_3_ID).call();

        assert.equal(saleTimeframe.start, SALE_3_START);
        assert.equal(saleTimeframe.end, SALE_3_END);

        // verify getSaleStatus getter
        const saleStatus = await initialized.methods.getSaleStatus(SALE_3_ID).call();
    
        assert.ok(!saleStatus.isSealed);
        assert.ok(!saleStatus.isAborted);
    })

    let SALE_SEALED_PAYLOAD_3;

    it('conductor should abort sale before the third sale starts', async function () {
        // test variables 
        const payloadIdType4 = "04";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // verify getSaleStatus getter before aborting
        const saleStatusBefore = await initialized.methods.sales(SALE_3_ID).call();
    
        assert.ok(!saleStatusBefore.isSealed);
        assert.ok(!saleStatusBefore.isAborted);

        // abort the sale
        let tx = await initialized.methods.abortSaleBeforeStartTime(SALE_3_ID).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // grab VAA so contributor can abort the sale
        const log = (await WORMHOLE.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues;

        // verify sale sealed payload
        SALE_SEALED_PAYLOAD_3 = log.payload;

        // payload id
        let index = 2
        assert.equal(SALE_SEALED_PAYLOAD_3.substr(index, 2), payloadIdType4);
        index += 2

        // sale id
        assert.equal(parseInt(SALE_SEALED_PAYLOAD_3.substr(index, 64), 16), SALE_3_ID);
        index += 64

        // verify getSaleStatus getter after aborting 
        const saleStatusAfter = await initialized.methods.sales(SALE_3_ID).call();
    
        assert.ok(!saleStatusAfter.isSealed);
        assert.ok(saleStatusAfter.isAborted);
    })

    it('should accept contributions after sale period starts and before aborting the sale (block timestamps out of sync test)', async function () {
        // this test simulates block timestamps being out of sync cross-chain
        await advanceTimeAndBlock(5);

        // test variables
        const tokenOneContributionAmount = "100";
        const tokenTwoContributionAmount = "50";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
            from:BUYER_ONE
        })
        await CONTRIBUTED_TOKEN_TWO.approve(TokenSaleContributor.address, tokenTwoContributionAmount, {
            from:BUYER_TWO
        })   

        // contribute tokens to the sale
        let tx = await initialized.methods.contribute(SALE_3_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount)).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        let tx2 = await initialized.methods.contribute(SALE_3_ID, TOKEN_TWO_INDEX, parseInt(tokenTwoContributionAmount)).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        // verify getSaleTotalContribution after contributing
        const totalContributionsTokenOne = await initialized.methods.getSaleTotalContribution(SALE_3_ID, TOKEN_ONE_INDEX).call();
        const totalContributionsTokenTwo = await initialized.methods.getSaleTotalContribution(SALE_3_ID, TOKEN_TWO_INDEX).call();

        assert.equal(totalContributionsTokenOne, parseInt(tokenOneContributionAmount));
        assert.equal(totalContributionsTokenTwo, parseInt(tokenTwoContributionAmount));

        // verify getSaleContribution
        const buyerOneContribution = await initialized.methods.getSaleContribution(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoContribution = await initialized.methods.getSaleContribution(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

        assert.equal(buyerOneContribution, parseInt(tokenOneContributionAmount));
        assert.equal(buyerTwoContribution, parseInt(tokenTwoContributionAmount));
    }) 

    it('contributor should abort third sale correctly', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // verify getSaleStatus before aborting in contributor
        const statusBefore = await initialized.methods.getSaleStatus(SALE_3_ID).call();

        assert.ok(!statusBefore.isAborted)
        assert.ok(!statusBefore.isSealed)

        const vm = await signAndEncodeVM(
            1,
            1,
            TEST_CHAIN_ID,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            SALE_SEALED_PAYLOAD_3,
            [
                testSigner1PK
            ],
            0,
            0
        );

        // abort the sale
        let tx = await initialized.methods.saleAborted("0x"+vm).send({
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        // confirm that saleAborted was set to true
        const statusAfter = await initialized.methods.getSaleStatus(SALE_3_ID).call();

        assert.ok(statusAfter.isAborted)
        assert.ok(!statusAfter.isSealed)
    })

    it('contributor should not allow contributions after sale is aborted early', async function () {
        // test variables
        const tokenOneContributionAmount = "100";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        await CONTRIBUTED_TOKEN_ONE.approve(TokenSaleContributor.address, tokenOneContributionAmount, {
            from:BUYER_ONE
        })
   
        let failed = false
        try {
            // try to contribute tokens to the sale
            await initialized.methods.contribute(SALE_3_ID, TOKEN_ONE_INDEX, parseInt(tokenOneContributionAmount)).send({
                from : BUYER_ONE,
                gasLimit : GAS_LIMIT
            })   
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale was aborted")
            failed = true
        }

        assert.ok(failed)
    })

    it('contributor should not allow contributions to be attested after sale is aborted early', async function () {
        await advanceTimeAndBlock(10);

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);
   
        let failed = false
        try {
            // attest contributions
            let tx = await initialized.methods.attestContributions(SALE_2_ID).send({
                from : BUYER_ONE,
                gasLimit : GAS_LIMIT
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale was aborted")
            failed = true
        }

        assert.ok(failed)
    })

    it('conductor should distribute refund to refundRecipient correctly after sale is aborted early', async function () {
        // test variables
        const expectedConductorBalanceBefore = "1000";
        const expectedSellerBalanceBefore = "0";
        const expectedConductorBalanceAfter = "0";
        const expectedSellerBalanceAfter = "1000";

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // confirm that refundIsClaimed is false
        const saleBefore = await initialized.methods.sales(SALE_3_ID).call();

        assert.ok(!saleBefore.refundIsClaimed);

        // check starting balances 
        const actualConductorBalanceBefore = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
        const actualSellerBalanceBefore = await SOLD_TOKEN.balanceOf(SELLER);

        assert.equal(actualConductorBalanceBefore, expectedConductorBalanceBefore);
        assert.equal(actualSellerBalanceBefore, expectedSellerBalanceBefore);

        // claim the sale token refund
        await initialized.methods.claimRefund(SALE_3_ID).send({
            from : SELLER,
            gasLimit : GAS_LIMIT
        });

        // make sure new balances are correct
        const actualConductorBalanceAfter = await SOLD_TOKEN.balanceOf(TokenSaleConductor.address);
        const actualSellerBalanceAfter = await SOLD_TOKEN.balanceOf(SELLER);

        assert.equal(actualConductorBalanceAfter, expectedConductorBalanceAfter);
        assert.equal(actualSellerBalanceAfter, expectedSellerBalanceAfter);

        // confirm that refundClaimed was set to true 
        const saleAfter = await initialized.methods.sales(SALE_3_ID).call();

        assert.ok(saleAfter.refundIsClaimed);
    })

    it('contributor should distribute refunds to contributors correctly after sale is aborted early', async function () {
        // test variables
        const expectedContributorTokenOneBalanceBefore = "100";
        const expectedContributorTokenTwoBalanceBefore = "300"; // lingering 250 from rolled back transaction earlier in test  
        const expectedBuyerOneBalanceBefore = "9900";
        const expectedBuyerTwoBalanceBefore = "14700";
        const expectedContributorTokenOneBalanceAfter = "0";
        const excpectedContributorTokenTwoBalanceAfter = "250";  
        const expectedBuyerOneBalanceAfter = "10000";
        const expectedBuyerTwoBalanceAfter = "14750";

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // confirm refundIsClaimed is set to false
        const buyerOneHasClaimedRefundBefore = await initialized.methods.refundIsClaimed(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoHasClaimedRefundBefore = await initialized.methods.refundIsClaimed(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

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
            from : BUYER_ONE,
            gasLimit : GAS_LIMIT
        })

        await initialized.methods.claimRefund(SALE_3_ID, TOKEN_TWO_INDEX).send({
            from : BUYER_TWO,
            gasLimit : GAS_LIMIT
        })

        // check balances of contributed tokens for buyers and the contributor 
        const actualContributorTokenOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(TokenSaleContributor.address);
        const actualContributorTokenTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(TokenSaleContributor.address);        
        const actualBuyerOneBalanceAfter = await CONTRIBUTED_TOKEN_ONE.balanceOf(BUYER_ONE);
        const actualBuyerTwoBalanceAfter = await CONTRIBUTED_TOKEN_TWO.balanceOf(BUYER_TWO);

        assert.equal(actualContributorTokenOneBalanceAfter, expectedContributorTokenOneBalanceAfter);
        assert.equal(actualContributorTokenTwoBalanceAfter, excpectedContributorTokenTwoBalanceAfter);
        assert.equal(actualBuyerOneBalanceAfter, expectedBuyerOneBalanceAfter);
        assert.equal(actualBuyerTwoBalanceAfter, expectedBuyerTwoBalanceAfter);

        // confirm refundIsClaimed is set to true
        const buyerOneHasClaimedRefundAfter = await initialized.methods.refundIsClaimed(SALE_3_ID, TOKEN_ONE_INDEX, BUYER_ONE).call();
        const buyerTwoHasClaimedRefundAfter = await initialized.methods.refundIsClaimed(SALE_3_ID, TOKEN_TWO_INDEX, BUYER_TWO).call();

        assert.ok(buyerOneHasClaimedRefundAfter);
        assert.ok(buyerTwoHasClaimedRefundAfter);
    })

    it('conductor should not allow a sale to abort after the sale start time', async function () {
        // test variables
        const current_block = await web3.eth.getBlock('latest');
        sale_start = current_block.timestamp + 5;
        sale_end = sale_start + 8;
        const saleTokenAmount = "1000";
        const minimumTokenRaise = "2000";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoConversionRate = "2000000000000000000";
        const saleRecipient = accounts[0];
        const refundRecipient = accounts[0];
        const sale_4_id = 3;

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        await SOLD_TOKEN.approve(TokenSaleConductor.address, saleTokenAmount)

        // create accepted tokens array 
        const acceptedTokens = [
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_ONE.address.substr(2),
                tokenOneConversionRate
            ],
            [
                TEST_CHAIN_ID,
                "0x000000000000000000000000" + CONTRIBUTED_TOKEN_TWO.address.substr(2),
                tokenTwoConversionRate
            ]
        ]

        // create a second sale
        let tx = await initialized.methods.createSale(
            SOLD_TOKEN.address,
            saleTokenAmount,
            minimumTokenRaise,
            sale_start,
            sale_end,
            acceptedTokens,
            saleRecipient,
            refundRecipient
        ).send({
            value : "0",
            from : SELLER,
            gasLimit : GAS_LIMIT
        })

        // wait for the sale to start
        await advanceTimeAndBlock(6);

        let failed = false
        try {
            // attest contributions
            let tx = await initialized.methods.abortSaleBeforeStartTime(sale_4_id).send({
                from : BUYER_ONE,
                gasLimit : GAS_LIMIT
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale cannot be aborted once it has started")
            failed = true
        }

        assert.ok(failed) 
    });

    it('parse saleInit from vaa (cross chain)', async function() {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vmPayload = "0x0100000000000000000000000000000000000000000000000000000000000000020000000000000000000000002d8be6bf0baa74e0a907016679cae9190e80dd0a00020000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000000240000000000000000000000000000000000000000000000000000000000000027c04000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e00020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000400000000000000000000000000000000000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c000200000000000000000000000000000000000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab3100040000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c100000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1";
        const parsed = await initialized.methods.parseSaleInit(vmPayload).call();

        // test variables
        const tokenDecimals = 18;
        const payloadIdType1 = "1";
        const saleId = "2";
        const saleTokenAddress = "0x0000000000000000000000002d8be6bf0baa74e0a907016679cae9190e80dd0a";
        const saleTokenChain = "2";
        const saleTokenAmount = 1;
        const minimumRaiseAmount = 10;
        const saleStart = "576";
        const saleEnd = "636";
        const tokenOneChainId = "2";
        const tokenOneAddress = "0x000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e";
        const tokenOneConversionRate = "1000000000000000000";
        const tokenTwoChainId = "4";
        const tokenTwoAddress = "0x000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e";
        const tokenTwoConversionRate = "200000000000000000";
        const tokenThreeChainId = "2";
        const tokenThreeAddress = "0x0000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c";
        const tokenThreeConversionRate = "200000000000000000";
        const tokenFourChainId = "4";
        const tokenFourAddress = "0x0000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31";
        const tokenFourConversionRate = "1000000000000000000";
        const saleRecipient = "0x00000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1";
        const refundRecipient = "0x00000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1";

        // verify data in the parsed payload
        assert.equal(parsed.payloadID, payloadIdType1);
        assert.equal(parsed.saleID, saleId);
        assert.equal(parsed.tokenAddress, saleTokenAddress);
        assert.equal(parsed.tokenChain, saleTokenChain);
        assert.equal(ethers.utils.formatUnits(parsed.tokenAmount, tokenDecimals), saleTokenAmount);
        assert.equal(ethers.utils.formatUnits(parsed.minRaise, tokenDecimals), minimumRaiseAmount);
        assert.equal(parsed.saleStart, saleStart);
        assert.equal(parsed.saleEnd, saleEnd);
        assert.equal(parsed.recipient, saleRecipient);
        assert.equal(parsed.refundRecipient, refundRecipient);

        // token one info
        const tokenOneInfo = parsed.acceptedTokens[0];

        assert.equal(tokenOneInfo.tokenChain, tokenOneChainId);
        assert.equal(tokenOneInfo.tokenAddress, tokenOneAddress);
        assert.equal(tokenOneInfo.conversionRate, tokenOneConversionRate);

        // token two info
        const tokenTwoInfo = parsed.acceptedTokens[1];

        assert.equal(tokenTwoInfo.tokenChain, tokenTwoChainId);
        assert.equal(tokenTwoInfo.tokenAddress, tokenTwoAddress);
        assert.equal(tokenTwoInfo.conversionRate, tokenTwoConversionRate);

        // token three info
        const tokenThreeInfo = parsed.acceptedTokens[2];

        assert.equal(tokenThreeInfo.tokenChain, tokenThreeChainId);
        assert.equal(tokenThreeInfo.tokenAddress, tokenThreeAddress);
        assert.equal(tokenThreeInfo.conversionRate, tokenThreeConversionRate);

        // token four info
        const tokenFourInfo = parsed.acceptedTokens[3];

        assert.equal(tokenFourInfo.tokenChain, tokenFourChainId);
        assert.equal(tokenFourInfo.tokenAddress, tokenFourAddress);
        assert.equal(tokenFourInfo.conversionRate, tokenFourConversionRate);
    });

    it('parse saleSealed payload from vaa (cross chain)', async function() {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vmPayload = "0x030000000000000000000000000000000000000000000000000000000000000001040000000000000000000000000000000000000000000000000005566da78f26762701000000000000000000000000000000000000000000000000038ef3c38c04e400020000000000000000000000000000000000000000000000000088a490c183d89d030000000000000000000000000000000000000000000000000472b0b62e0f0800";
        const parsed = await initialized.methods.parseSaleSealed(vmPayload).call();

        // test variables
        const payloadIdType3 = "3";
        const saleId = "1";
        const tokenOneIndex = "0";
        const tokenTwoIndex = "1";
        const tokenThreeIndex = "2";
        const tokenFourIndex = "3";
        const tokenDecimals = 18;
        const tokenOneAllo = 0.384615384615384615;
        const tokenTwoAllo = 0.25641025;
        const tokenThreeAllo = 0.038461538461538461;
        const tokenFourAllo = 0.32051282;

        // verify data in the parsed payload
        assert.equal(parsed.payloadID, payloadIdType3);
        assert.equal(parsed.saleID, saleId);

        // allocation one info
        const alloOne = parsed.allocations[0];
        assert.equal(alloOne.tokenIndex, tokenOneIndex)
        assert.equal(ethers.utils.formatUnits(alloOne.allocation, tokenDecimals), tokenOneAllo);

        // allocation two info
        const alloTwo = parsed.allocations[1];
        assert.equal(alloTwo.tokenIndex, tokenTwoIndex);
        assert.equal(ethers.utils.formatUnits(alloTwo.allocation, tokenDecimals), tokenTwoAllo);

        // allocation three info
        const alloThree = parsed.allocations[2];
        assert.equal(alloThree.tokenIndex, tokenThreeIndex);
        assert.equal(ethers.utils.formatUnits(alloThree.allocation, tokenDecimals), tokenThreeAllo);

        // allocation four info
        const alloFour = parsed.allocations[3];
        assert.equal(alloFour.tokenIndex, tokenFourIndex);
        assert.equal(ethers.utils.formatUnits(alloFour.allocation, tokenDecimals), tokenFourAllo);
    });
});

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
        web3.eth.abi.encodeParameter("uint16", emitterChainId).substring(2 + (64 - 4)),
        web3.eth.abi.encodeParameter("bytes32", emitterAddress).substring(2),
        web3.eth.abi.encodeParameter("uint64", sequence).substring(2 + (64 - 16)),
        web3.eth.abi.encodeParameter("uint8", consistencyLevel).substring(2 + (64 - 2)),
        data.substr(2)
    ]

    const hash = web3.utils.soliditySha3(web3.utils.soliditySha3("0x" + body.join("")))

    let signatures = "";

    for (let i in signers) {
        const ec = new elliptic.ec("secp256k1");
        const key = ec.keyFromPrivate(signers[i]);
        const signature = key.sign(hash.substr(2), {canonical: true});

        const packSig = [
            web3.eth.abi.encodeParameter("uint8", i).substring(2 + (64 - 2)),
            zeroPadBytes(signature.r.toString(16), 32),
            zeroPadBytes(signature.s.toString(16), 32),
            web3.eth.abi.encodeParameter("uint8", signature.recoveryParam).substr(2 + (64 - 2)),
        ]

        signatures += packSig.join("")
    }

    const vm = [
        web3.eth.abi.encodeParameter("uint8", 1).substring(2 + (64 - 2)),
        web3.eth.abi.encodeParameter("uint32", guardianSetIndex).substring(2 + (64 - 8)),
        web3.eth.abi.encodeParameter("uint8", signers.length).substring(2 + (64 - 2)),

        signatures,
        body.join("")
    ].join("");

    return vm
}

function zeroPadBytes(value, length) {
    while (value.length < 2 * length) {
        value = "0" + value;
    }
    return value;
}

advanceTimeAndBlock = async (time) => {
    await advanceTime(time);
    await advanceBlock();

    return Promise.resolve(web3.eth.getBlock('latest'));
}

advanceTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    });
}

advanceBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            const newBlockHash = web3.eth.getBlock('latest').hash;

            return resolve(newBlockHash)
        });
    });
}

revert = (snapshotId) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_revert',
            id: new Date().getTime(),
            params: [snapshotId]
        }, (err, result) => {
            if (err) {
                return reject(err)
            }
            return resolve(result)
        })
    })
}

snapshot = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_snapshot',
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err)
            }
            return resolve(result.result)
        })
    })
}
