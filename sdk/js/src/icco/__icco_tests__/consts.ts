import { describe, expect, it } from "@jest/globals";

const ci = !!process.env.CI;

// see devnet.md
export const ETH_NODE_URL = ci ? "ws://eth-devnet:8545" : "ws://localhost:8545";
export const BSC_NODE_URL = ci ? "ws://eth-devnet:8546" : "ws://localhost:8546";

export const ETH_PRIVATE_KEY1 =
  "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
export const ETH_PRIVATE_KEY2 =
  "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1";
export const ETH_PRIVATE_KEY3 =
  "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c";

export const ETH_CORE_BRIDGE_ADDRESS =
  "0xC89Ce4735882C9F0f0FE26686c53074E09B0D550";
export const ETH_TOKEN_BRIDGE_ADDRESS =
  "0x0290FB167208Af455bB137780163b7B7a9a10C16";

// contributors only registered with conductor on CHAIN_ID_ETH
export const ETH_TOKEN_SALE_CONDUCTOR_ADDRESS =
  "0x5f8e26fAcC23FA4cbd87b8d9Dbbd33D5047abDE1";
export const ETH_TOKEN_SALE_CONTRIBUTOR_ADDRESS =
  "0xaD888d0Ade988EbEe74B8D4F39BF29a8d0fe8A8D";

export const WETH_ADDRESS = "0xDDb64fE46a91D46ee29420539FC25FD07c5FEa3E";
export const WBNB_ADDRESS = "0xDDb64fE46a91D46ee29420539FC25FD07c5FEa3E";
export const TEST_ERC20 = "0x2D8BE6BF0baA74e0A907016679CaE9190e80dD0A";

export const WORMHOLE_RPC_HOSTS = ci
  ? ["http://guardian:7071"]
  : ["http://localhost:7071"];

describe("consts should exist", () => {
  it("dummy test", () => {
    expect.assertions(0);
  });
});
