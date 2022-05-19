const fs = require("fs");
const {
    // Connection,
    // Keypair,
    PublicKey,
    // Transaction,
} = require("@solana/web3.js");

async function main() {
    const tilt = JSON.parse(fs.readFileSync(`${__dirname}/../tilt.json`, "utf8"));
    const conductorAddress = "000000000000000000000000" + tilt.conductorAddress.substring(2);
    const ca = new PublicKey(Buffer.from(conductorAddress, 'hex'));
    console.log(ca.toString());
}
main();
