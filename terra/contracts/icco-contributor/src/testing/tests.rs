use cosmwasm_std::testing::{mock_env, mock_info};
use cosmwasm_std::{from_binary, Binary, StdResult, Uint128, Uint256};

use icco::common::{SaleAborted, SaleSealed};

use crate::{
    contract::{execute, instantiate, query},
    msg::{
        AcceptedTokenResponse, ConfigResponse, ExecuteMsg, InstantiateMsg, QueryMsg,
        SaleRegistryResponse, SaleStatusResponse, SaleTimesResponse, TotalAllocationResponse,
        TotalContributionResponse,
    },
    state::SaleMessage,
    testing::mock_querier::mock_dependencies,
};

/*

    initSale vaa 0x01000000000100fd75a4cd9fe22519fbe7856267f59d0e0bf9931bf8a7733de4e7b576451ae1b3309c9adee5c96e82e9b06b03fa16e189e3fe9eff132c1f9ce922710524a6476300000003880000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000000f01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000083752ecafebf4707258dedffbd9c7443148169db00020000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000000000000000038c00000000000000000000000000000000000000000000000000000000000003c806000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000200000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c0002000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb140000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb14000000000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b

  console.info
    parsed {
      payloadId: 1,
      saleId: '0',
      tokenAddress: '00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db',
      tokenChain: 2,
      tokenAmount: '1000000000000000000',
      minRaise: '10000000000000000000',
      saleStart: '908',
      saleEnd: '968',
      acceptedTokens: [
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 2,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c',
          tokenChain: 2,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31',
          tokenChain: 4,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        }
      ],
      recipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b',
      refundRecipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b'
    }

    saleSealed vaa 0x010000000001002223f7096e8e7e1edbc75d9998e2d26b2a8b45bd99764c870e1b0bafd880b2db5100a780239cee5dd0c30bf872dddfe445dc9ea0abd0439b6e546abd2a2f769901000003f70000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000010f0300000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000047a09633e414a520100000000000000000000000000000000000000000000000002fc06415c6980000200000000000000000000000000000000000000000000000000729a89eca021080300000000000000000000000000000000000000000000000003bb07d1b383e0000400000000000000000000000000000000000000000000000000e53511bee2f000050000000000000000000000000000000000000000000000000157cf9cf2604c00

      at Object.<anonymous> (src/icco/__icco_tests__/helpers.ts:800:11)

  console.info
    parsed {
      payloadId: 3,
      saleId: '0',
      allocations: [
        { tokenIndex: 0, allocation: '322580645161290322' },
        { tokenIndex: 1, allocation: '215053760000000000' },
        { tokenIndex: 2, allocation: '32258064516129032' },
        { tokenIndex: 3, allocation: '268817200000000000' },
        { tokenIndex: 4, allocation: '64516120000000000' },
        { tokenIndex: 5, allocation: '96774190000000000' }
      ]
    }

    initSale vaa 0x01000000000100e4b21bbfd4a77e8f524e625f0744ee948282d1f11022cadd0e4d57001946884f76c47d612a9ff24aa7fbf689b0da35325c125a9ad1e665659c8f212bbc948c3f00000004380000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000020f0100000000000000000000000000000000000000000000000000000000000000010000000000000000000000005f9d8f5c2648220bc45ba9eea6adb8c38920494300020000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000000000000000043b000000000000000000000000000000000000000000000000000000000000047706000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e000200000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c0002000000000000000002c68af0bb1400000000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000de0b6b3a7640000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb140000000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb14000000000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b

      at Object.<anonymous> (src/icco/__icco_tests__/helpers.ts:583:11)
          at runMicrotasks (<anonymous>)

  console.info
    parsed {
      payloadId: 1,
      saleId: '1',
      tokenAddress: '0000000000000000000000005f9d8f5c2648220bc45ba9eea6adb8c389204943',
      tokenChain: 2,
      tokenAmount: '1000000000000000000',
      minRaise: '10000000000000000000',
      saleStart: '1083',
      saleEnd: '1143',
      acceptedTokens: [
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 2,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c',
          tokenChain: 2,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31',
          tokenChain: 4,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        }
      ],
      recipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b',
      refundRecipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b'
    }

      at Object.<anonymous> (src/icco/__icco_tests__/helpers.ts:586:11)
          at runMicrotasks (<anonymous>)

  console.info
    saleAborted vaa 0x010000000001003f2c65c95e0309fec40c863e6f9d318141c7febc648f87f9f65ba43e64c33840574e461593dffc11a8d577bd0c8e9fe9368b5789fd2cc30e6fe0faf1699af53400000004900000000000020000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde100000000000000030f040000000000000000000000000000000000000000000000000000000000000001
*/

// fake addresses for initialize
const WORMHOLE_ADDRESS: &str = "terra1dcegyrekltswvyy0xy69ydgxn9x8x32zdtapd8";
const TOKEN_BRIDGE_ADDRESS: &str = "terra1dcegyrekltswvyy0xy69ydgxn9x8x32zdtapd8";

#[test]
fn proper_initialization() -> StdResult<()> {
    let mut deps = mock_dependencies(&[]);
    let info = mock_info("creator", &[]);

    let conductor_chain = 2u16;
    let conductor_address = "0000000000000000000000005f8e26facc23fa4cbd87b8d9dbbd33d5047abde1";
    let conductor_address = hex::decode(conductor_address).unwrap();
    let conductor_address = conductor_address.as_slice();
    let owner = info.sender.to_string();

    let msg = InstantiateMsg {
        wormhole: WORMHOLE_ADDRESS.into(),
        token_bridge: TOKEN_BRIDGE_ADDRESS.into(),
        conductor_chain: conductor_chain,
        conductor_address: Binary::from(conductor_address),
    };

    let response = instantiate(deps.as_mut(), mock_env(), info, msg.clone())?;
    assert_eq!(
        response.messages.len(),
        0,
        "response.messages.len() != 0 after instantiate"
    );

    // it worked, let's query the state
    let response = query(deps.as_ref(), mock_env(), QueryMsg::Config {})?;
    let config: ConfigResponse = from_binary(&response)?;

    assert_eq!(
        config,
        ConfigResponse {
            conductor_chain,
            conductor_address: conductor_address.to_vec(),
            owner,
        },
        "config != ConfigResponse"
    );

    Ok(())
}

#[test]
fn init_sale() -> StdResult<()> {
    let mut deps = mock_dependencies(&[]);
    let info = mock_info("creator", &[]);

    let conductor_chain = 2u16;
    let conductor_address = "000000000000000000000000f19a2a01b70519f67adb309a994ec8c69a967e8b";
    let conductor_address = hex::decode(conductor_address).unwrap();
    let conductor_address = conductor_address.as_slice();

    let msg = InstantiateMsg {
        wormhole: WORMHOLE_ADDRESS.into(),
        token_bridge: TOKEN_BRIDGE_ADDRESS.into(),
        conductor_chain: conductor_chain,
        conductor_address: Binary::from(conductor_address),
    };

    let response = instantiate(deps.as_mut(), mock_env(), info, msg)?;
    assert_eq!(
        response.messages.len(),
        0,
        "response.messages.len() != 0 after instantiate"
    );

    let signed_vaa = "\
        01000000000100ae0eda623b8aae9bde03c68922ac218bb0c3aa9c5ea0a70a7a\
        caea0a46d0915a7b3a06758250e44e6c543a37ea1097b85be6f75bd07127b802\
        38ed6e6b73cbc00000000563000000000002000000000000000000000000f19a\
        2a01b70519f67adb309a994ec8c69a967e8b00000000000000000f0100000000\
        0000000000000000000000000000000000000000000000000000000000000000\
        000000000000000083752ecafebf4707258dedffbd9c7443148169db00020000\
        000000000000000000000000000000000000000000000de0b6b3a76400000000\
        000000000000000000000000000000000000000000008ac7230489e800000000\
        00000000000000000000000000000000000000000000c249fdd3277800000000\
        0000000000000000000000000000000000000000000000000000000005670000\
        0000000000000000000000000000000000000000000000000000000005a30400\
        0000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e00\
        0200000000000000000de0b6b3a7640000000000000000000000000000ddb64f\
        e46a91d46ee29420539fc25fd07c5fea3e0004000000000000000002c68af0bb\
        1400000000000000000000000000008a5bbc20ad253e296f61601e868a3206b2\
        d4774c0002000000000000000002c68af0bb1400000000000000000000000000\
        003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31000400000000000000000d\
        e0b6b3a764000000000000000000000000000022d491bde2303f2f43325b2108\
        d26f1eaba1e32b00000000000000000000000022d491bde2303f2f43325b2108\
        d26f1eaba1e32b";
    let signed_vaa = hex::decode(signed_vaa).unwrap();

    let info = mock_info("addr0001", &[]);
    let msg = ExecuteMsg::InitSale {
        data: Binary::from(signed_vaa.as_slice()),
    };
    let _response = execute(deps.as_mut(), mock_env(), info, msg)?;

    let sale_id = "0000000000000000000000000000000000000000000000000000000000000000";
    let sale_id = hex::decode(sale_id).unwrap();
    let sale_id = sale_id.as_slice();

    let response = query(
        deps.as_ref(),
        mock_env(),
        QueryMsg::SaleStatus {
            sale_id: Binary::from(sale_id),
        },
    )?;
    let sale_status: SaleStatusResponse = from_binary(&response)?;

    assert_eq!(
        sale_status.is_sealed, false,
        "sale_status.is_sealed is true"
    );
    assert_eq!(
        sale_status.is_aborted, false,
        "sale_status.is_aborted is true"
    );

    let response = query(
        deps.as_ref(),
        mock_env(),
        QueryMsg::SaleRegistry {
            sale_id: Binary::from(sale_id),
        },
    )?;
    let sale: SaleRegistryResponse = from_binary(&response)?;
    assert_eq!(sale.id.as_slice(), sale_id);

    /* expected output
    payloadId: 1,
      saleId: '0',
      tokenAddress: '00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db',
      tokenChain: 2,
      tokenAmount: '1000000000000000000',
      minRaise: '10000000000000000000',
      saleStart: '908',
      saleEnd: '968',
      acceptedTokens: [
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 2,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c',
          tokenChain: 2,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '0000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31',
          tokenChain: 4,
          conversionRate: '1000000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        },
        {
          tokenAddress: '000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e',
          tokenChain: 4,
          conversionRate: '200000000000000000'
        }
      ],
      recipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b',
      refundRecipient: '00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b'
      */

    // token address
    let token_address = "00000000000000000000000083752ecafebf4707258dedffbd9c7443148169db";
    let token_address = hex::decode(token_address).unwrap();
    assert_eq!(
        sale.token_address.as_slice(),
        token_address.as_slice(),
        "sale.token_address != expected"
    );

    // token chain
    assert_eq!(sale.token_chain, 2u16);

    // token amount
    let token_amount = Uint256::from(1_000_000_000_000_000_000u128);
    assert_eq!(
        sale.token_amount, token_amount,
        "sale.token_amount != expected"
    );

    let min_raise = Uint256::from(10_000_000_000_000_000_000u128);
    assert_eq!(sale.min_raise, min_raise, "sale.min_raise != expected");

    let max_raise = Uint256::from(10_000_000_000_000_000_000u128);
    assert_eq!(sale.min_raise, max_raise, "sale.max_raise != expected");

    let sale_start = 1383u64;
    assert_eq!(sale.sale_start, sale_start, "sale.sale_start != expected");

    let sale_end = 1443u64;
    assert_eq!(sale.sale_end, sale_end, "sale.sale_end != expected");

    let recipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
    let recipient = hex::decode(recipient).unwrap();
    assert_eq!(&sale.recipient, &recipient, "sale.recipient != expected");

    let refund_recipient = "00000000000000000000000022d491bde2303f2f43325b2108d26f1eaba1e32b";
    let refund_recipient = hex::decode(refund_recipient).unwrap();
    assert_eq!(
        &sale.refund_recipient, &refund_recipient,
        "sale.refund_recipient != expected"
    );

    // double-check sale times
    let response = query(
        deps.as_ref(),
        mock_env(),
        QueryMsg::SaleTimes {
            sale_id: Binary::from(sale_id),
        },
    )?;
    let sale_times: SaleTimesResponse = from_binary(&response)?;
    assert_eq!(sale.id.as_slice(), sale_id);
    assert_eq!(sale.sale_start, sale_times.start);
    assert_eq!(sale.sale_end, sale_times.end);

    // check accepted tokens
    let accepted_token_addresses = Vec::from([
        "000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e",
        "000000000000000000000000ddb64fe46a91d46ee29420539fc25fd07c5fea3e",
        "0000000000000000000000008a5bbc20ad253e296f61601e868a3206b2d4774c",
        "0000000000000000000000003d9e7a12daa29a8b2b1bfaa9dc97ce018853ab31",
    ]);
    let accepted_token_chains = Vec::from([2u16, 4u16, 2u16, 4u16, 4u16, 4u16]);
    let accepted_token_conversion_rates = Vec::from([
        1_000_000_000_000_000_000u128,
        200_000_000_000_000_000u128,
        200_000_000_000_000_000u128,
        1_000_000_000_000_000_000u128,
    ]);

    let n_accepted_tokens = accepted_token_addresses.len();

    for i in 0..n_accepted_tokens {
        let token_index = i as u8;

        let response = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::AcceptedToken {
                sale_id: Binary::from(sale_id),
                token_index,
            },
        )?;
        let token: AcceptedTokenResponse = from_binary(&response)?;
        assert_eq!(
            token.chain, accepted_token_chains[i],
            "token.chain != expected"
        );

        let token_address = hex::decode(accepted_token_addresses[i]).unwrap();
        assert_eq!(&token.address, &token_address, "token.address != expected");
        assert_eq!(
            token.conversion_rate.u128(),
            accepted_token_conversion_rates[i],
            "token.conversion_rate != expected"
        );

        // now verify contributions and allocations are zeroed out
        let response = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::TotalContribution {
                sale_id: Binary::from(sale_id),
                token_index,
            },
        )?;
        let total_contribution: TotalContributionResponse = from_binary(&response)?;
        assert_eq!(
            total_contribution.amount,
            Uint128::zero(),
            "total_contribution.amount != 0"
        );

        let response = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::TotalAllocation {
                sale_id: Binary::from(sale_id),
                token_index,
            },
        )?;
        let total_allocation: TotalAllocationResponse = from_binary(&response)?;
        assert_eq!(
            total_allocation.amount,
            Uint128::zero(),
            "total_allocation.amount != 0"
        );
    }

    Ok(())
}

#[test]
fn test_sale_sealed() -> StdResult<()> {
    let vaa_payload_stringified = "\
        03\
        0000000000000000000000000000000000000000000000000000000000000000\
        06\
        00\
        000000000000000000000000000000000000000000000000047a09633e414a52\
        01\
        00000000000000000000000000000000000000000000000002fc06415c698000\
        02\
        00000000000000000000000000000000000000000000000000729a89eca02108\
        03\
        00000000000000000000000000000000000000000000000003bb07d1b383e000\
        04\
        00000000000000000000000000000000000000000000000000e53511bee2f000\
        05\
        0000000000000000000000000000000000000000000000000157cf9cf2604c00";

    let vaa_payload = hex::decode(vaa_payload_stringified).unwrap();

    let message = SaleMessage::deserialize(vaa_payload.as_slice())?;
    assert_eq!(message.id, SaleSealed::PAYLOAD_ID);

    let sale_sealed = SaleSealed::deserialize(message.payload)?;

    // sale id
    let expected_sale_id = vec![0u8; 32];
    assert_eq!(sale_sealed.sale_id.len(), expected_sale_id.len());
    assert_eq!(sale_sealed.sale_id, expected_sale_id);

    Ok(())
}

#[test]
fn test_sale_aborted() -> StdResult<()> {
    let vaa_payload_stringified = "\
        04\
        0000000000000000000000000000000000000000000000000000000000000000";

    let vaa_payload = hex::decode(vaa_payload_stringified).unwrap();

    let message = SaleMessage::deserialize(vaa_payload.as_slice())?;
    assert_eq!(message.id, SaleAborted::PAYLOAD_ID);

    let sale_aborted = SaleAborted::deserialize(message.payload)?;

    // sale id
    let expected_sale_id = vec![0u8; 32];
    assert_eq!(sale_aborted.sale_id.len(), expected_sale_id.len());
    assert_eq!(sale_aborted.sale_id, expected_sale_id);

    Ok(())
}
