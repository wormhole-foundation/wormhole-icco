const fs = require("fs");
const {
    // Connection,
    // Keypair,
    PublicKey,
    // Transaction,
} = require("@solana/web3.js");

async function main() {
    {
        // hex->b58
        const hexAddress = "000000000000000000000000ac92a45c2b0ce520e12dd696af589073e86b2f47";
        const ca = new PublicKey(Buffer.from(hexAddress, 'hex'));
        console.log(hexAddress, " -> ", ca.toString());
    }

    {
        // b58 -> hex
        const ca = new PublicKey("BbbuDvFGriSjKy1zoxENNMewRcxdBnrFEeAD4wjERPWm");
        console.log(ca.toString(), " -> ", ca.toBytes().toString("hex"));
    }    
}
main();
