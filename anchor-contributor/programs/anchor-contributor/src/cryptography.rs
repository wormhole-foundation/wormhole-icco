use anchor_lang::prelude::Result;
use anchor_lang::solana_program::{keccak, secp256k1_recover::secp256k1_recover};

use crate::error::ContributorError;

pub fn ethereum_ecrecover(sig: &[u8], msg: &[u8; 32]) -> Result<[u8; 20]> {
    let recovered = secp256k1_recover(msg.as_slice(), sig[64], &sig[0..64])
        .map_err(|_| ContributorError::EcdsaRecoverFailure)?;

    let hash = keccak::hash(&recovered.to_bytes());

    let mut pubkey = [0u8; 20];
    pubkey.copy_from_slice(&hash.to_bytes()[12..32]);
    Ok(pubkey)
}

#[cfg(test)]
pub mod test {
    use super::*;
    use itertools::izip;

    #[test]
    fn test_ethereum_ecrecover() -> Result<()> {
        let msgs = [
            "d62efc12bf7722b6cb53a67ce1179e6c3ef88daab5aa33e55c8ded771480802d",
            "ae82e15be2effa4800bc09610d54512abe1f52be6802a87385b895a6c8e4e0fd",
            "13dec14fa12d44fc90d66b322d9f2302590660b205c152b030ab4aafbea4aa6f",
            "7766bedc7da3c5bb93a70dcba06eda741f8da7732926d80a33e319d1a57b3e1b",
            "3ab687ea6e0e44807ddca6dec757d1529dc464b11819ee91a561195f52511235",
            "987de2c8ff7d375fafca3e44b4a0251ea7dd964e6b33e4e9e94bc7dfe5acff2e",
            "4cd4b6e793aab5e2a8a263459e089ea2299c35ed051328a92033483afde66751",
            "fd6db9ce2c79df1dedaf32efa80af39a59f354a885d26391f0ae94e43652d87d",
        ];
        let signatures = [
            "dc4d6e7afa4d286eeec1547d5bc1631d25b20748c6152b803ddc124debfbc2f95f93e61e2c6c0e3fa9a1d7d060da5901b94c1769d7e76fb083087320e853885400",
            "644659488ec8976cbc3a6b8118c826ca9753056136044d1b5bc62dea21bde8c44e2c4adc607bf32850f603ecf67a7028828f2fdc5bcf430b2c64f406bf1bffe400",
            "8b79f0f57c2a4e0ce4f9725c1e0f5f2b639cfbb03439bc6454ee59b5c46fb2cb3a562b272e9ffd1ea6e121292e4746298d44450a4d1554820cd7f93fd518c3a801",
            "4f8889df8c744e8c041e7f7aaf133e1da6708357d400d0ea7f19c15b70c1c0b37c8a3ec23d841ecb05e216a53f7c22e435185e51e557bfd522511309a0af0bfd01",
            "c51dffa4f5c4e3b3a1710f2ca7e420e89763b1444ed5caa1e137419bc278447365849310a593e9b00bfc9328605c71e3c36a115fe6aa961b3c8ef26a6f4a596401",
            "affc1f53934c7d7519a1078442b748ed9392e171dd1e8501f64156d7b0f172184f8cea200d928c4d27c5cdea51810f4a5266a41f6faac6aa5dfe01b47d59939901",
            "3d3b32d7b56d7d304a68d8543a2ddbbe8ead030c080314003c074b07b277368c13559b915e1d3323ef7a688a1d928938d43b68d47e7beb4b862edd021abc6d8101",
            "7e721bef8fb497a6f3cc383abe3a93d307e6a16929d3e20a2265fac68726f4024efed0ec1e9a5be3984982412e62575d0b143bf867f382fea2f39a205e5377ba01",
        ];

        let signer_public_key = "1df62f291b2e969fb0849d99d9ce41e2f137006e";
        let signer_public_key: [u8; 20] =
            hex::decode(signer_public_key).unwrap().try_into().unwrap();

        for (msg, signature) in izip!(msgs.iter(), signatures.iter()) {
            let msg = hex::decode(msg).unwrap();
            assert!(msg.len() == 32, "msg.len != 32");

            let mut fixed = [0u8; 32];
            fixed.copy_from_slice(&msg);

            let signature = hex::decode(signature).unwrap();
            assert!(signature.len() == 65, "signature.len != 65");

            let recovered = ethereum_ecrecover(&signature, &fixed)?;
            assert!(recovered == signer_public_key, "recovered != expected");
        }
        Ok(())
    }
}
