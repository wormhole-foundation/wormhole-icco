// run this script with truffle exec

const jsonfile = require("jsonfile");
const elliptic = require("elliptic");
const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const TokenSaleContributor = artifacts.require("TokenSaleContributor");

//sdk.setDefaultWasm("node");

const ConductorImplementationFullABI = jsonfile.readFileSync(
  "../build/contracts/ConductorImplementation.json"
).abi;

const testSigner1PK =
  "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";

module.exports = async function(callback) {
  try {
    const emitters = new Map();
    {
      // const solanaProgAddr = "22mamxmojFWBdbGqaxTH46HBAgAY2bJRiGJJHfNRNQ95";  //TBD Not used, because I could not get WH sdk to be available in tilt.
      const solanaEmitterAddr =
        "0xaeab35a8d36bbaad38154ca4ca6a0770e7009326316d59ef2c8a2123e90d174c"; // Derived from solanaProgAddr using await sdk.getEmitterAddressSolana(..);

      // Build chainId -> ContributorAddr map.
      const ethEmitterAddress =
        "0x000000000000000000000000" + TokenSaleContributor.address.substr(2);
      const bscEmitterAddress =
        "0x000000000000000000000000" + TokenSaleContributor.address.substr(2);
      emitters.set(1, solanaEmitterAddr);
      emitters.set(2, ethEmitterAddress);
      emitters.set(4, bscEmitterAddress);
    }

    // register all chainId -> ContributorAddr with conductor.
    for (const [chainId, emitter] of emitters.entries()) {
      console.log("ChainId: ", chainId, " emitter: ", emitter);
      const governanceChainId = process.env.ICCO_CONTRIBUTOR_INIT_GOV_CHAIN_ID;
      const governanceContract = process.env.ICCO_CONTRIBUTOR_INIT_GOV_CONTRACT;

      const accounts = await web3.eth.getAccounts();
      const initialized = new web3.eth.Contract(
        ConductorImplementationFullABI,
        TokenSaleConductor.address
      );

      const data = [
        "0x",
        "0000000000000000000000000000000000000000000000546f6b656e53616c65",
        "01",
        "0000",
        web3.eth.abi.encodeParameter("uint16", chainId).substring(2 + (64 - 4)),
        web3.eth.abi.encodeParameter("bytes32", emitter).substring(2),
      ].join("");

      const vm = await signAndEncodeVM(
        1,
        1,
        governanceChainId,
        governanceContract,
        0,
        data,
        [testSigner1PK],
        0,
        0
      );

      // Register the ETH contributor
      await initialized.methods.registerChain("0x" + vm).send({
        value: 0,
        from: accounts[0],
        gasLimit: 2000000,
      });
    }
    callback();
  } catch (e) {
    callback(e);
  }
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
