pub const CORE_BRIDGE_ADDRESS: &str = "Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o";
pub const TOKEN_BRIDGE_ADDRESS: &str = "B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE";
pub const SEED_PREFIX_SALE: &str = "icco-sale";

// vaa payload types
pub const PAYLOAD_SALE_INIT: u8 = 1;
pub const PAYLOAD_ATTEST_CONTRIBUTIONS: u8 = 2;
pub const PAYLOAD_SALE_SEALED: u8 = 3;
pub const PAYLOAD_SALE_ABORTED: u8 = 4;

// for sale init
pub const SEED_PREFIX_ACCEPTED_TOKEN_PAGE: &str = "accepted-token-page";
pub const INDEX_ACCEPTED_TOKENS_START: usize = 228;
pub const ACCEPTED_TOKENS_N_BYTES: usize = 50;
pub const ACCEPTED_TOKENS_MAX: usize = 256;
pub const ACCEPTED_TOKENS_PER_PAGE: u8 = 170;


// for sale sealed
pub const INDEX_ALLOCATIONS_START: usize = 33;
