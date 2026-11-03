//! Independent Supra BTC/USD pull-proof verification for Solana.
//!
//! Decode compact proof bytes followed by 324 arithmetic witness bytes with
//! [`Proof::decode`], then authenticate them with [`Proof::verify`] or
//! [`Proof::verify_with`]. Only successful verification yields a [`VerifiedQuote`].
//! Decoding alone is not authentication. The caller must enforce freshness,
//! ordering, replay protection and its own settlement policy after verification.
//!
//! The default trust is a historical committee-1 snapshot, not a live trust feed.
//! Authenticate any replacement independently; never trust keys from a proof
//! response. See the packaged README, NOTICE and docs/provenance.md.
//!
//! ```
//! use supra_verifier_solana::{Error, Proof, VerifiedQuote};
//!
//! fn authenticate(bytes: &[u8]) -> Result<VerifiedQuote<'_>, Error> {
//!     Proof::decode(bytes)?.verify()
//! }
//! ```
#![forbid(unsafe_code)]

use solana_program::program_error::ProgramError;
/// Low-level BN254, Merkle and trust-key primitives.
/// Prefer [`Proof`] for complete BTC/USD proof verification.
pub mod crypto;

/// Byte length of the packed signed quote.
pub const QUOTE_LEN: usize = 38;
/// Maximum supported sorted Merkle path depth.
pub const MAX_DEPTH: usize = 16;
/// Committee ID in the independently captured default trust snapshot.
pub const TRUSTED_COMMITTEE: u64 = 1;
/// Two untrusted, checked, 162-byte arithmetic witnesses.
pub const WITNESS_LEN: usize = 324;
/// Maximum age used by the example's policy; the library does not check time.
pub const MAX_AGE_MS: u64 = 1_800_000;
/// The only supported feed: BTC/USD. BTC/USDT is a different feed.
pub const BTC_USD_PAIR: u32 = 18;

/// Verification errors and example policy errors.
///
/// Conversion to [`ProgramError`] uses these numeric discriminants directly.
/// Applications with their own error namespace should map errors explicitly.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// Malformed compact proof encoding.
    Encoding = 1,
    /// Wrong committee or invalid trust key.
    Committee,
    /// Unsupported feed identifier.
    Pair,
    /// Zero price or unsupported decimal count.
    Price,
    /// Observation outside the example's exact-second window.
    Window,
    /// Future observation or boundary in the example.
    Future,
    /// Reused or unordered observation in the example.
    Ordering,
    /// Merkle inclusion mismatch.
    Merkle,
    /// Invalid BLS signature or pairing.
    Signature,
    /// Group arithmetic failed.
    Crypto,
    /// Invalid arithmetic witness.
    Witness,
    /// Stale observation in the example.
    Stale,
}

impl core::fmt::Display for Error {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(formatter, "Supra verification error: {self:?}")
    }
}

impl std::error::Error for Error {}

impl From<Error> for ProgramError {
    fn from(error: Error) -> Self {
        Self::Custom(error as u32)
    }
}

/// A decoded, unauthenticated compact proof plus arithmetic witnesses.
///
/// Fields are private so malformed slices cannot bypass [`Self::decode`]. No
/// quote accessor is exposed until signature and inclusion verification succeed.
#[derive(Clone, Copy, Debug)]
pub struct Proof<'a> {
    committee: u64,
    quote: &'a [u8; QUOTE_LEN],
    root: &'a [u8; 32],
    signature: &'a [u8; 64],
    siblings: &'a [u8],
    witnesses: &'a [u8; WITNESS_LEN],
}

/// A signed BTC/USD observation authenticated by a verified proof.
///
/// This establishes authenticity under the selected trust, not freshness,
/// economic accuracy, authorization to settle, or perpetual validity of the key.
/// Price is an integer scaled by `10^decimals`; timestamps retain milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VerifiedQuote<'a> {
    committee: u64,
    bytes: &'a [u8; QUOTE_LEN],
}

impl<'a> VerifiedQuote<'a> {
    /// Committee authenticated using the caller-selected trust.
    pub fn committee(&self) -> u64 {
        self.committee
    }

    /// Signed feed ID (currently always [`BTC_USD_PAIR`]).
    pub fn pair(&self) -> u32 {
        u32::from_le_bytes(self.bytes[..4].try_into().unwrap())
    }

    /// Original positive, unsigned integer price; never a floating-point value.
    pub fn price(&self) -> u128 {
        u128::from_le_bytes(self.bytes[4..20].try_into().unwrap())
    }

    /// Original signed observation time, in Unix milliseconds.
    pub fn timestamp_ms(&self) -> u64 {
        u64::from_le_bytes(self.bytes[20..28].try_into().unwrap())
    }

    /// Number of decimal places used by the integer price (at most 18).
    pub fn decimals(&self) -> u16 {
        u16::from_le_bytes(self.bytes[28..30].try_into().unwrap())
    }

    /// Original oracle round identifier; applications define their replay policy.
    pub fn oracle_round(&self) -> u64 {
        u64::from_le_bytes(self.bytes[30..38].try_into().unwrap())
    }

    /// Original authenticated, packed 38-byte quote, without any retiming.
    pub fn as_bytes(&self) -> &'a [u8; QUOTE_LEN] {
        self.bytes
    }
}

impl<'a> Proof<'a> {
    /// Decode exactly one compact proof followed by its 324-byte witnesses.
    /// Rejects truncation, trailing bytes and paths deeper than [`MAX_DEPTH`].
    /// Successful decoding does **not** authenticate the data.
    pub fn decode(bytes: &'a [u8]) -> Result<Self, Error> {
        const PREFIX: usize = 8 + QUOTE_LEN + 32 + 64 + 1;
        if bytes.len() < PREFIX + WITNESS_LEN {
            return Err(Error::Encoding);
        }
        let depth = bytes[PREFIX - 1] as usize;
        let proof_end = PREFIX + depth * 32;
        if depth > MAX_DEPTH || bytes.len() != proof_end + WITNESS_LEN {
            return Err(Error::Encoding);
        }
        Ok(Self {
            committee: u64::from_le_bytes(bytes[..8].try_into().unwrap()),
            quote: bytes[8..46].try_into().unwrap(),
            root: bytes[46..78].try_into().unwrap(),
            signature: bytes[78..142].try_into().unwrap(),
            siblings: &bytes[PREFIX..proof_end],
            witnesses: bytes[proof_end..].try_into().unwrap(),
        })
    }

    fn validate_quote_for(&self, committee: u64) -> Result<(), Error> {
        if self.committee != committee {
            return Err(Error::Committee);
        }
        if u32::from_le_bytes(self.quote[..4].try_into().unwrap()) != BTC_USD_PAIR {
            return Err(Error::Pair);
        }
        let price = u128::from_le_bytes(self.quote[4..20].try_into().unwrap());
        let decimals = u16::from_le_bytes(self.quote[28..30].try_into().unwrap());
        if price == 0 || decimals > 18 {
            return Err(Error::Price);
        }
        Ok(())
    }

    /// Verify using the historical committee-1 public-key/domain snapshot.
    /// This performs no Clock reads and imposes no freshness or lifecycle policy.
    pub fn verify(&self) -> Result<VerifiedQuote<'a>, Error> {
        self.verify_with(
            TRUSTED_COMMITTEE,
            &crypto::CANONICAL_PUBLIC_KEY,
            &crypto::CANONICAL_DOMAIN,
        )
    }

    /// Verify using independently authenticated, application-configured trust.
    /// Never pass trust learned from the untrusted proof response. Validate keys
    /// at configuration time with [`crypto::validate_public_key`], and bind the
    /// selected trust to any application state that depends on it.
    pub fn verify_with(
        &self,
        committee: u64,
        key: &[u8; 128],
        domain: &[u8; 32],
    ) -> Result<VerifiedQuote<'a>, Error> {
        self.validate_quote_for(committee)?;
        crypto::verify_merkle(self.quote, self.siblings, self.root)?;
        crypto::verify_signature_with_key(self.root, self.signature, self.witnesses, key, domain)?;
        Ok(VerifiedQuote {
            committee: self.committee,
            bytes: self.quote,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        let json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/btc-usd.json")).unwrap();
        hex::decode(format!(
            "{}{}",
            json["compactHex"].as_str().unwrap(),
            json["witnessHex"].as_str().unwrap()
        ))
        .unwrap()
    }

    #[test]
    fn authentic_public_btc_usd_proof_matches_the_independent_evm_verifier() {
        Proof::decode(&fixture()).unwrap().verify().unwrap();
    }

    #[test]
    fn authenticated_quote_preserves_original_integer_fields() {
        let bytes = fixture();
        let quote = Proof::decode(&bytes).unwrap().verify().unwrap();
        assert_eq!(quote.committee(), 1);
        assert_eq!(quote.pair(), 18);
        assert_eq!(quote.price(), 7_788_800_500_000);
        assert_eq!(quote.decimals(), 8);
        assert_eq!(quote.timestamp_ms(), 1_793_558_849_138);
        assert_eq!(quote.oracle_round(), 1_793_558_849_000);
        assert_eq!(quote.as_bytes(), &bytes[8..46]);
    }

    #[test]
    fn configured_trust_cannot_change_the_authenticated_authority() {
        let bytes = fixture();
        let proof = Proof::decode(&bytes).unwrap();
        assert_eq!(
            proof.verify_with(2, &crypto::CANONICAL_PUBLIC_KEY, &crypto::CANONICAL_DOMAIN),
            Err(Error::Committee)
        );
        assert!(proof
            .verify_with(1, &[0; 128], &crypto::CANONICAL_DOMAIN)
            .is_err());
        let mut other_domain = crypto::CANONICAL_DOMAIN;
        other_domain[0] ^= 1;
        assert!(proof
            .verify_with(1, &crypto::CANONICAL_PUBLIC_KEY, &other_domain)
            .is_err());
    }

    #[test]
    fn low_level_merkle_verification_rejects_partial_and_oversized_paths() {
        let bytes = fixture();
        let proof = Proof::decode(&bytes).unwrap();
        let mut partial = proof.siblings.to_vec();
        partial.push(0);
        assert_eq!(
            crypto::verify_merkle(proof.quote, &partial, proof.root),
            Err(Error::Encoding)
        );
        assert_eq!(
            crypto::verify_merkle(proof.quote, &[0; 17 * 32], proof.root),
            Err(Error::Encoding)
        );
        assert_eq!(
            crypto::verify_merkle(&proof.quote[..37], proof.siblings, proof.root),
            Err(Error::Encoding)
        );
    }

    #[test]
    fn changing_any_signed_field_or_merkle_sibling_fails() {
        let original = fixture();
        for index in [8, 12, 28, 36, 38, 46, 78, 110, 143] {
            let mut altered = original.clone();
            altered[index] ^= 1;
            assert!(
                Proof::decode(&altered).unwrap().verify().is_err(),
                "byte {index}"
            );
        }
    }

    #[test]
    fn unknown_committee_and_zero_signature_fail_closed() {
        let mut bytes = fixture();
        bytes[..8].copy_from_slice(&2_u64.to_le_bytes());
        assert_eq!(
            Proof::decode(&bytes).unwrap().verify(),
            Err(Error::Committee)
        );
        bytes[..8].copy_from_slice(&TRUSTED_COMMITTEE.to_le_bytes());
        bytes[78..142].fill(0);
        assert_eq!(
            Proof::decode(&bytes).unwrap().verify(),
            Err(Error::Signature)
        );
    }

    #[test]
    fn independently_evm_verified_vectors_cover_all_mapping_branches() {
        let document: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/vectors.json")).unwrap();
        assert_eq!(document["cases"].as_array().unwrap().len(), 12);
        for vector in document["vectors"].as_array().unwrap() {
            let bytes = hex::decode(format!(
                "{}{}",
                vector["compactHex"].as_str().unwrap(),
                vector["witnessHex"].as_str().unwrap()
            ))
            .unwrap();
            Proof::decode(&bytes).unwrap().verify().unwrap();
        }
    }

    #[test]
    fn untrusted_witness_corruptions_are_rejected() {
        let original = fixture();
        for index in original.len() - WITNESS_LEN..original.len() {
            let mut altered = original.clone();
            altered[index] ^= 1;
            assert!(
                Proof::decode(&altered).unwrap().verify().is_err(),
                "witness byte {index}"
            );
        }
    }

    #[test]
    fn a_valid_merkle_tree_without_a_valid_signature_is_rejected() {
        let json: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/forged-tree.json")).unwrap();
        let forged = hex::decode(format!(
            "{}{}",
            json["compactHex"].as_str().unwrap(),
            json["witnessHex"].as_str().unwrap()
        ))
        .unwrap();
        let proof = Proof::decode(&forged).unwrap();
        crypto::verify_merkle(proof.quote, proof.siblings, proof.root).unwrap();
        assert_eq!(proof.verify(), Err(Error::Signature));
        // A zero signature fails even before any expensive map arithmetic.
        assert_eq!(
            crypto::verify_signature(proof.root, &[0; 64], &[0; WITNESS_LEN]),
            Err(Error::Signature)
        );
        let mut invalid = [0; 64];
        invalid[31] = 1;
        invalid[63] = 1;
        assert_eq!(
            crypto::verify_signature(proof.root, &invalid, proof.witnesses),
            Err(Error::Signature)
        );
    }

    #[test]
    fn rejects_truncation_trailing_data_and_unbounded_paths() {
        let original = fixture();
        for length in 0..original.len() {
            assert!(Proof::decode(&original[..length]).is_err());
        }
        let mut bytes = original.clone();
        bytes.push(0);
        assert!(Proof::decode(&bytes).is_err());
        bytes[142] = 255;
        assert!(Proof::decode(&bytes).is_err());
    }
}
