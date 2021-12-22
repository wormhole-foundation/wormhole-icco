const jsonfile = require('jsonfile');
const elliptic = require('elliptic');

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
    const testChainId = "2";
    const testGovernanceChainId = "1";
    const testGovernanceContract = "0x0000000000000000000000000000000000000000000000000000000000000004";

    const wormhole = new web3.eth.Contract(WormholeImplementationFullABI, Wormhole.address);
    
    it("conductor should be initialized with the correct values", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        // chain id
        const chainId = await initialized.methods.chainId().call();
        assert.equal(chainId, testChainId);

        // wormhole
        const wormhole = await initialized.methods.wormhole().call();
        assert.equal(wormhole, Wormhole.address);

        // tokenBridge
        const tokenbridge = await initialized.methods.tokenBridge().call();
        assert.equal(tokenbridge, TokenBridge.address);

        // governance
        const governanceChainId = await initialized.methods.governanceChainId().call();
        assert.equal(governanceChainId, testGovernanceChainId);
        const governanceContract = await initialized.methods.governanceContract().call();
        assert.equal(governanceContract, testGovernanceContract);
    })

    it("contributor should be initialized with the correct values", async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        // chain id
        const chainId = await initialized.methods.chainId().call();
        assert.equal(chainId, testChainId);

        // conductor
        const conductorChainId = await initialized.methods.conductorChainId().call();
        assert.equal(conductorChainId, testChainId);
        const conductorContract = await initialized.methods.conductorContract().call();
        assert.equal(conductorContract.substr(26).toLowerCase(), TokenSaleConductor.address.substr(2).toLowerCase());

        // wormhole
        const wormhole = await initialized.methods.wormhole().call();
        assert.equal(wormhole, (await Wormhole.deployed()).address);

        // tokenBridge
        const tokenbridge = await initialized.methods.tokenBridge().call();
        assert.equal(tokenbridge, (await TokenBridge.deployed()).address);

        // governance
        const governanceChainId = await initialized.methods.governanceChainId().call();
        assert.equal(governanceChainId, testGovernanceChainId);
        const governanceContract = await initialized.methods.governanceContract().call();
        assert.equal(governanceContract, testGovernanceContract);
    })

    it("conductor should register a contributor implementation correctly", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        let data = [
            "0x",
            "0000000000000000000000000000000000000000000000546f6b656e53616c65",
            "01",
            "0000",
            web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("bytes32", "0x000000000000000000000000" + TokenSaleContributor.address.substr(2)).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            testGovernanceChainId,
            testGovernanceContract,
            0,
            data,
            [
                testSigner1PK
            ],
            0,
            0
        );


        let before = await initialized.methods.contributorContracts(testChainId).call();

        assert.equal(before, "0x0000000000000000000000000000000000000000000000000000000000000000");

        await initialized.methods.registerChain("0x" + vm).send({
            value: 0,
            from: accounts[0],
            gasLimit: 2000000
        });

        let after = await initialized.methods.contributorContracts(testChainId).call();

        assert.equal(after.substr(26).toLowerCase(), TokenSaleContributor.address.substr(2).toLowerCase());
    })


    it("conductor should accept a valid upgrade", async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const mock = await MockConductorImplementation.new();

        let data = [
            "0x",
            "0000000000000000000000000000000000000000000000546f6b656e53616c65",
            "02",
            web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("address", mock.address).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            testGovernanceChainId,
            testGovernanceContract,
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
            gasLimit: 2000000
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
            web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + (64 - 4)),
            web3.eth.abi.encodeParameter("address", mock.address).substring(2),
        ].join('')

        const vm = await signAndEncodeVM(
            1,
            1,
            testGovernanceChainId,
            testGovernanceContract,
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
            gasLimit: 2000000
        });

        let after = await web3.eth.getStorageAt(TokenSaleContributor.address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        assert.equal(after.toLowerCase(), mock.address.toLowerCase());

        const mockImpl = new web3.eth.Contract(MockContributorImplementation.abi, TokenSaleContributor.address);

        let isUpgraded = await mockImpl.methods.testNewImplementationActive().call();

        assert.ok(isUpgraded);
    })


    var soldToken;
    var contributedTokenOne;
    var contributedTokenTwo;
    const seller = accounts[0];
    const buyerOne = accounts[1];
    const buyerTwo = accounts[2];

    it('mint one token to sell, two to buy', async function () {
        soldToken = await TokenImplementation.new()
        await soldToken.initialize(
            "Sold Token",
            "SOLD",
            18,
            0,
            accounts[0],
            0,
            "0x00"
        );
        await soldToken.mint(seller, "1000")

        contributedTokenOne = await TokenImplementation.new()
        await contributedTokenOne.initialize(
            "Contributed Stablecoin",
            "STABLE",
            18,
            0,
            accounts[0],
            0,
            "0x00"
        );
        await contributedTokenOne.mint(buyerOne, "10000")

        contributedTokenTwo = await TokenImplementation.new()
        await contributedTokenTwo.initialize(
            "Contributed Coin",
            "COIN",
            18,
            0,
            accounts[0],
            0,
            "0x00"
        );
        await contributedTokenTwo.mint(buyerTwo, "10000")
    })

    let saleStart;
    let saleEnd;
    let saleInitPayload;

    let saleInitSnapshot;

    it('create a sale correctly and attest over wormhole', async function () {
        saleStart = Math.floor(Date.now() / 1000) + 5;
        saleEnd = saleStart + 8;

        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        await soldToken.approve(TokenSaleConductor.address, "1000")

        let tx = await initialized.methods.createSale(
            soldToken.address,
            "1000",
            "2000",
            saleStart,
            saleEnd,
            [[
                testChainId,
                "0x000000000000000000000000" + contributedTokenOne.address.substr(2),
                "1000000000000000000" // multiplier 1
            ],[
                testChainId,
                "0x000000000000000000000000" + contributedTokenTwo.address.substr(2),
                "2000000000000000000" // multiplier 2
            ]],
            accounts[0],
            accounts[0]
        ).send({
            value : "0",
            from : seller,
            gasLimit : "2000000"
        })

        const wormhole = new web3.eth.Contract(WormholeImplementationFullABI, Wormhole.address);

        const log = (await wormhole.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleConductor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), "01")
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 0);
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", soldToken.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + 64 - 4))
        index += 4

        // token amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 1000);
        index += 64

        // min raise amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 2000);
        index += 64

        // timestamp start
        assert.equal(parseInt(log.payload.substr(index, 64), 16), saleStart);
        index += 64

        // timestamp end
        assert.equal(parseInt(log.payload.substr(index, 64), 16), saleEnd);
        index += 64

        // accepted tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), 2);
        index += 2

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", contributedTokenOne.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 1000000000000000000);
        index += 64

        // token address
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", contributedTokenTwo.address).substring(2));
        index += 64

        // token chain
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", testChainId).substring(2 + 64 - 4))
        index += 4

        // conversion rate
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 2000000000000000000);
        index += 64

        // recipient of proceeds
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", accounts[0]).substring(2));
        index += 64

        // refund recipient in case the sale is aborted
        assert.equal(log.payload.substr(index, 64), web3.eth.abi.encodeParameter("address", accounts[0]).substring(2));
        index += 64

        assert.equal(log.payload.length, index)
        saleInitPayload = log.payload.toString()

        // TODO: verify getter

        saleInitSnapshot = await snapshot()
    })

    it('should init a sale in the contributor', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vm = await signAndEncodeVM(
            1,
            1,
            testChainId,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            saleInitPayload,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let tx = await initialized.methods.initSale("0x"+vm).send({
            from : seller,
            gasLimit : "2000000"
        })

        // TODO: verify getter
    })

    it('should accept contributions in the contributor during the sale timeframe', async function () {
        await timeout(5000)

        await contributedTokenOne.approve(TokenSaleContributor.address, "10000", {
            from:buyerOne
        })
        await contributedTokenTwo.approve(TokenSaleContributor.address, "10000", {
            from:buyerTwo
        })

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        let tx = await initialized.methods.contribute(0,0,10000).send({
            from : buyerOne,
            gasLimit : "2000000"
        })

        let tx2 = await initialized.methods.contribute(0,1,5000).send({
            from : buyerTwo,
            gasLimit : "2000000"
        })
    })

    it('should not accept contributions after the sale has ended', async function () {
        await timeout(10000)

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        let failed = false
        try {
            await initialized.methods.contribute(0,1,5000).send({
                from : buyerTwo,
                gasLimit : "2000000"
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert sale has ended")
            failed = true
        }

        assert.ok(failed)
    })

    let contributionsPayload;

    // TODO: fail contribution after end
    it('should attest contributions correctly', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);
        let tx = await initialized.methods.attestContributions(0).send({
            from : buyerOne,
            gasLimit : "2000000"
        })

        const wormhole = new web3.eth.Contract(WormholeImplementationFullABI, Wormhole.address);

        const log = (await wormhole.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        assert.equal(log.sender, TokenSaleContributor.address)

        // payload id
        let index = 2
        assert.equal(log.payload.substr(index, 2), "02")
        index += 2

        // sale id
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 0);
        index += 64

        // chain id
        assert.equal(log.payload.substr(index, 4), web3.eth.abi.encodeParameter("uint16", 2).substring(2 + 64 - 4))
        index += 4

        // tokens length
        assert.equal(parseInt(log.payload.substr(index, 2), 16), 2);
        index += 2

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 0).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 10000);
        index += 64

        // token index
        assert.equal(log.payload.substr(index, 2), web3.eth.abi.encodeParameter("uint8", 1).substring(2 + 64 - 2))
        index += 2

        // amount
        assert.equal(parseInt(log.payload.substr(index, 64), 16), 5000);
        index += 64

        assert.equal(log.payload.length, index);

        contributionsPayload = log.payload.toString()
    })

    it('conductor should collect contributions correctly', async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const vm = await signAndEncodeVM(
            1,
            1,
            testChainId,
            "0x000000000000000000000000"+TokenSaleContributor.address.substr(2),
            0,
            contributionsPayload,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let tx = await initialized.methods.collectContribution("0x"+vm).send({
            from : seller,
            gasLimit : "2000000"
        })
    })

    let saleSealedPayload

    it('conductor should seal the sale correctly and distribute tokens', async function () {
        const initialized = new web3.eth.Contract(ConductorImplementationFullABI, TokenSaleConductor.address);

        const contributorBalanceBefore = await soldToken.balanceOf(TokenSaleContributor.address);
        const conductorBalanceBefore = await soldToken.balanceOf(TokenSaleConductor.address);

        assert.equal(contributorBalanceBefore, "0")
        assert.equal(conductorBalanceBefore, "1000")

        let tx = await initialized.methods.sealSale(0).send({
            from : seller,
            gasLimit : "2000000"
        })

        const contributorBalanceAfter = await soldToken.balanceOf(TokenSaleContributor.address);
        const conductorBalanceAfter = await soldToken.balanceOf(TokenSaleConductor.address);

        assert.equal(contributorBalanceAfter, "1000")
        assert.equal(conductorBalanceAfter, "0")

        const log = (await wormhole.getPastEvents('LogMessagePublished', {
            fromBlock: 'latest'
        }))[0].returnValues

        saleSealedPayload = log.payload
    })

    it('contributor should seal a sale correctly', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const vm = await signAndEncodeVM(
            1,
            1,
            testChainId,
            "0x000000000000000000000000"+TokenSaleConductor.address.substr(2),
            0,
            saleSealedPayload,
            [
                testSigner1PK
            ],
            0,
            0
        );

        let tx = await initialized.methods.saleSealed("0x"+vm).send({
            from : buyerOne,
            gasLimit : "2000000"
        })

        // todo verify getters
    })

    let oneClaimSnapshot
    it('contributor should distribute tokens correctly', async function () {
        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        const contributorBalanceBefore = await soldToken.balanceOf(TokenSaleContributor.address);
        const buyerOneBalanceBefore = await soldToken.balanceOf(buyerOne);
        const buyerTwoBalanceBefore = await soldToken.balanceOf(buyerTwo);

        assert.equal(contributorBalanceBefore, "1000")
        assert.equal(buyerOneBalanceBefore, "0")
        assert.equal(buyerTwoBalanceBefore, "0")

        await initialized.methods.claimAllocation(0, 1).send({
            from : buyerTwo,
            gasLimit : "2000000"
        })

        oneClaimSnapshot = await snapshot()

        await initialized.methods.claimAllocation(0, 0).send({
            from : buyerOne,
            gasLimit : "2000000"
        })

        const contributorBalanceAfter = await soldToken.balanceOf(TokenSaleContributor.address);
        const buyerOneBalanceAfter = await soldToken.balanceOf(buyerOne);
        const buyerTwoBalanceAfter = await soldToken.balanceOf(buyerTwo);

        assert.equal(contributorBalanceAfter, "0")
        assert.equal(buyerOneBalanceAfter, "500")
        assert.equal(buyerTwoBalanceAfter, "500")
    })

    it('allocation should only be claimable once', async function () {
        await revert(oneClaimSnapshot)

        const initialized = new web3.eth.Contract(ContributorImplementationFullABI, TokenSaleContributor.address);

        let failed = false
        try {
            await initialized.methods.claimAllocation(0, 1).send({
                from : buyerTwo,
                gasLimit : "2000000"
            })
        } catch(e) {
            assert.equal(e.message, "Returned error: VM Exception while processing transaction: revert allocation already claimed")
            failed = true
        }

        assert.ok(failed)
    })
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

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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