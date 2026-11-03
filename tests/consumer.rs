//! Exercise only the public API used by an independently configured program.
use supra_verifier_solana::{crypto, Error, Proof, BTC_USD_PAIR, TRUSTED_COMMITTEE};

#[test]
fn configured_consumer_reads_only_authenticated_original_fields() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/btc-usd.json")).unwrap();
    let bytes = hex::decode(format!(
        "{}{}",
        fixture["compactHex"].as_str().unwrap(),
        fixture["witnessHex"].as_str().unwrap()
    ))
    .unwrap();
    crypto::validate_public_key(&crypto::CANONICAL_PUBLIC_KEY).unwrap();
    let authenticate = |bytes: &[u8]| {
        let quote = Proof::decode(bytes)?.verify_with(
            BTC_USD_PAIR,
            TRUSTED_COMMITTEE,
            &crypto::CANONICAL_PUBLIC_KEY,
            &crypto::CANONICAL_DOMAIN,
        )?;
        // Consumers may use a narrower integer, but must reject overflow.
        let price = i64::try_from(quote.price()).map_err(|_| Error::Price)?;
        Ok::<_, Error>((
            quote.pair(),
            price,
            -i32::from(quote.decimals()),
            quote.timestamp_ms(),
            quote.oracle_round(),
            *quote.as_bytes(),
        ))
    };
    let (pair, price, exponent, milliseconds, round, quote) = authenticate(&bytes).unwrap();
    assert_eq!(pair, BTC_USD_PAIR);
    assert_eq!(
        price as u128,
        u128::from_le_bytes(bytes[12..28].try_into().unwrap())
    );
    assert_eq!(exponent, -8);
    assert_eq!(
        milliseconds,
        u64::from_le_bytes(bytes[28..36].try_into().unwrap())
    );
    assert_eq!(round, u64::from_le_bytes(bytes[38..46].try_into().unwrap()));
    assert_eq!(quote.as_slice(), &bytes[8..46]);

    let mut forged = bytes.clone();
    forged[12] ^= 1;
    assert_eq!(authenticate(&forged), Err(Error::Merkle));
    let mut other_committee = bytes;
    other_committee[..8].copy_from_slice(&2_u64.to_le_bytes());
    assert_eq!(authenticate(&other_committee), Err(Error::Committee));
}
