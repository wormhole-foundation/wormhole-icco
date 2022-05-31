pub const CORE_BRIDGE_ADDRESS: &str = "Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o";
pub const TOKEN_BRIDGE_ADDRESS: &str = "B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE";
//pub const CONDUCTOR_CHAIN: u16 = 2;
//pub const CONDUCTOR_ADDRESS: &str =
//    "0000000000000000000000005c49f34d92316a2ac68d10a1e2168e16610e84f9";

// seed prefixes
pub const SEED_PREFIX_SALE: &str = "icco-sale";
pub const SEED_PREFIX_BUYER: &str = "icco-buyer";

pub const CHAIN_ID: u16 = 1;

// vaa payload types
pub const PAYLOAD_SALE_INIT_SOLANA: u8 = 5; // 1 for everyone else
pub const PAYLOAD_ATTEST_CONTRIBUTIONS: u8 = 2;
pub const PAYLOAD_SALE_SEALED_SOLANA: u8 = 6; // 3 for everyone else
pub const PAYLOAD_SALE_ABORTED: u8 = 4;

// universal
pub const PAYLOAD_HEADER_LEN: usize = 33; // payload + sale id
pub const INDEX_SALE_ID: usize = 1;

// for sale init
pub const INIT_INDEX_TOKEN_ADDRESS: usize = 33;
pub const INIT_INDEX_TOKEN_CHAIN: usize = 65;
pub const INIT_INDEX_TOKEN_DECIMALS: usize = 67;
pub const INIT_INDEX_SALE_START: usize = 68;
pub const INIT_INDEX_SALE_END: usize = 100;
pub const INIT_INDEX_ACCEPTED_TOKENS_START: usize = 132;

pub const ACCEPTED_TOKENS_N_BYTES: usize = 33;
pub const ACCEPTED_TOKENS_MAX: usize = 10;

// for attest contributions
pub const ATTEST_CONTRIBUTIONS_ELEMENT_LEN: usize = 33; // token index + amount

// for sale sealed
pub const INDEX_ALLOCATIONS_START: usize = 33;
