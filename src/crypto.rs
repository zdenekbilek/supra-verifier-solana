//! Port of the MIT-licensed Supra BLS.sol FT mapping and SHA-256 expansion.
//! Provenance and source hashes are recorded in docs/provenance.md / fixtures.

use crate::Error;
use ark_bn254::Fq;
use ark_ff::{BigInteger, Field, MontFp, PrimeField};
use hex_literal::hex;
use solana_bn254::prelude::{alt_bn128_g1_addition_be, alt_bn128_pairing_be};
use solana_program::{hash::hashv, keccak};

/// Signing domain from the historical, independently read verifier snapshot.
pub const CANONICAL_DOMAIN: [u8; 32] =
    hex!("b2b5ca56968e81bf5845ee0e6c6888aff023d02790943f6947a389b2e2892ea5");
/// Historical committee-1 G2 key in Ethereum pairing encoding.
/// This constant does not track committee rotation; see docs/provenance.md.
pub const CANONICAL_PUBLIC_KEY: [u8; 128] = hex!(
    "2535b66171a31794ed30734a45f30ec29a758f0f1ae00ddd33fd99eacc03d2f52
     e63d39b9199fb81e369b54867dde1ef8598020c684f579e9e68b9184c12b2eb0
     4c261cb7164e8131fae9a36906fa1b430fd336ab0d55c2d2b4f1ce1336b71e2
     1df112b0b8d28da9f29216fb44ce825ab1dfccc6c2414ab8407e61a839838527"
);
/// Historical committee-0 G2 key from the same independently read snapshot.
/// Select committee 0 explicitly with `Proof::verify_with`; the default remains 1.
pub const HISTORICAL_COMMITTEE_0_PUBLIC_KEY: [u8; 128] = hex!(
    "0671a6b13d4c2a4a5d6120809f6c13646096c481c330262855d26f90f7c2aabf297f48f4e39995914214c5398501b63f2a08bdb58367765262be42383a8a910a053d6ad98fba37e3d303e15aca887cb33d48c32de0add55de5ae0a5d658076d808004c7c7f1c92003f468e1549543321ada9d926b858db4f5663dc431536d8e2"
);
const NEGATIVE_G2: [u8; 128] = hex!(
    "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2
     1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed
     275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec
     1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d"
);
const MODULUS: [u8; 32] = hex!("30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47");
const Z0: Fq = MontFp!("4407920970296243842837207485651524041948558517760411303933");
const Z1: Fq = MontFp!("2203960485148121921418603742825762020974279258880205651966");

/// SHA-256 commitment to a committee ID, key and signing domain.
pub fn trust_hash(committee: u64, key: &[u8; 128], domain: &[u8; 32]) -> [u8; 32] {
    hashv(&[&committee.to_le_bytes()[..], &key[..], &domain[..]]).to_bytes()
}

/// Verify a packed 38-byte quote against a bounded, sorted Merkle path.
/// This alone does not authenticate the root; prefer `Proof::verify`.
pub fn verify_merkle(quote: &[u8], siblings: &[u8], root: &[u8; 32]) -> Result<(), Error> {
    if quote.len() != crate::QUOTE_LEN
        || !siblings.chunks_exact(32).remainder().is_empty()
        || siblings.len() > crate::MAX_DEPTH * 32
    {
        return Err(Error::Encoding);
    }
    let mut current = keccak::hash(quote).to_bytes();
    for sibling in siblings.chunks_exact(32) {
        current = if current.as_slice() < sibling {
            keccak::hashv(&[&current, sibling]).to_bytes()
        } else {
            keccak::hashv(&[sibling, &current]).to_bytes()
        };
    }
    if &current != root {
        return Err(Error::Merkle);
    }
    Ok(())
}

fn bytes(value: Fq) -> [u8; 32] {
    let encoded = value.into_bigint().to_bytes_be();
    let mut out = [0; 32];
    out[32 - encoded.len()..].copy_from_slice(&encoded);
    out
}

fn field(bytes: &[u8]) -> Result<Fq, Error> {
    if bytes.len() != 32 || bytes >= MODULUS.as_slice() {
        return Err(Error::Witness);
    }
    Ok(Fq::from_be_bytes_mod_order(bytes))
}

fn map_to_point(input: Fq, hints: &[u8]) -> Result<[u8; 64], Error> {
    if hints.len() != 162 || hints[0] > 1 || hints[1] > 2 {
        return Err(Error::Witness);
    }
    let decision = hints[0] == 1;
    let branch = hints[1] as usize;
    let decision_root = field(&hints[2..34])?;
    if (input == Fq::from(0) && !decision)
        || decision_root.square() != if decision { input } else { -input }
    {
        return Err(Error::Witness);
    }
    let a0 = input.square() + Fq::from(4);
    let a1 = input * Z0;
    let denominator = a1 * a0;
    let a2 = field(&hints[34..66])?;
    if if denominator == Fq::from(0) {
        a2 != Fq::from(0)
    } else {
        a2 * denominator != Fq::from(1)
    } {
        return Err(Error::Witness);
    }
    let adjustment = input * a1.square() * a2;
    let x1 = Z1 - adjustment;
    let x2 = -(x1 + Fq::from(1));
    let x3 = a0.square().square() * a2.square() + Fq::from(1);
    let candidates = [x1, x2, x3];
    for (i, candidate) in candidates.iter().take(2).enumerate() {
        let rejected_root = field(&hints[98 + i * 32..130 + i * 32])?;
        if i < branch {
            let curve = candidate.square() * candidate + Fq::from(3);
            // -1 is a nonsquare in this field. A nonzero curve value whose
            // negative is square cannot be square: skipped branches are proven.
            if curve == Fq::from(0) || rejected_root.square() != -curve {
                return Err(Error::Witness);
            }
        } else if rejected_root != Fq::from(0) {
            return Err(Error::Witness);
        }
    }
    let x = candidates[branch];
    // y0 is itself square. Together with y0² = x³ + 3 this uniquely identifies
    // the exact sqrt returned by Supra's exponentiation (p = 3 mod 4).
    let mut y = field(&hints[66..98])?.square();
    if y.square() != x.square() * x + Fq::from(3) {
        return Err(Error::Witness);
    }
    if !decision {
        y = -y;
    }
    let mut out = [0; 64];
    out[..32].copy_from_slice(&bytes(x));
    out[32..].copy_from_slice(&bytes(y));
    Ok(out)
}

fn hash_to_field(root: &[u8; 32], domain: &[u8; 32]) -> [Fq; 2] {
    // expand_message_xmd(SHA-256), 96 output bytes, 32-byte domain.
    let zero_pad = [0; 64];
    let b0 = hashv(&[&zero_pad, root, &[0, 96, 0], domain, &[32]]).to_bytes();
    let mut previous = hashv(&[&b0, &[1], domain, &[32]]).to_bytes();
    let mut expanded = [0; 96];
    expanded[..32].copy_from_slice(&previous);
    for block in 2_u8..=3 {
        let xor = std::array::from_fn::<_, 32, _>(|i| b0[i] ^ previous[i]);
        previous = hashv(&[&xor, &[block], domain, &[32]]).to_bytes();
        let start = (block as usize - 1) * 32;
        expanded[start..start + 32].copy_from_slice(&previous);
    }
    [
        Fq::from_be_bytes_mod_order(&expanded[..48]),
        Fq::from_be_bytes_mod_order(&expanded[48..]),
    ]
}

fn hash_to_point(root: &[u8; 32], witnesses: &[u8], domain: &[u8; 32]) -> Result<[u8; 64], Error> {
    if witnesses.len() != 324 {
        return Err(Error::Witness);
    }
    let inputs = hash_to_field(root, domain);
    let first = map_to_point(inputs[0], &witnesses[..162])?;
    let second = map_to_point(inputs[1], &witnesses[162..])?;
    let mut addition = [0; 128];
    addition[..64].copy_from_slice(&first);
    addition[64..].copy_from_slice(&second);
    alt_bn128_g1_addition_be(&addition)
        .map_err(|_| Error::Crypto)?
        .try_into()
        .map_err(|_| Error::Crypto)
}

/// Verify a root signature using the historical default key/domain snapshot.
/// This alone does not bind a price leaf or enforce application timing.
pub fn verify_signature(root: &[u8; 32], signature: &[u8], witnesses: &[u8]) -> Result<(), Error> {
    verify_signature_with_key(
        root,
        signature,
        witnesses,
        &CANONICAL_PUBLIC_KEY,
        &CANONICAL_DOMAIN,
    )
}

/// Verify a root signature using independently authenticated application trust.
/// The witnesses are untrusted arithmetic hints checked by the verifier.
pub fn verify_signature_with_key(
    root: &[u8; 32],
    signature: &[u8],
    witnesses: &[u8],
    public_key: &[u8; 128],
    domain: &[u8; 32],
) -> Result<(), Error> {
    if signature.len() != 64 || signature.iter().all(|byte| *byte == 0) {
        return Err(Error::Signature);
    }
    // The pairing syscall validates canonical field values, curve membership
    // and the G2 subgroup. Trust selection is the application's responsibility.
    let point = hash_to_point(root, witnesses, domain)?;
    let mut input = [0; 384];
    input[..64].copy_from_slice(signature);
    input[64..192].copy_from_slice(&NEGATIVE_G2);
    input[192..256].copy_from_slice(&point);
    input[256..].copy_from_slice(public_key);
    let result = alt_bn128_pairing_be(&input).map_err(|_| Error::Signature)?;
    let mut expected = [0; 32];
    expected[31] = 1;
    if result.as_slice() != expected {
        return Err(Error::Signature);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately slow, exponentiation-based reference. This runs only in
    // native tests; the deployed verifier must establish the same deterministic
    // result from untrusted witnesses without expensive field exponentiation.
    fn reference_map(input: Fq) -> [u8; 64] {
        let mut exponent = Fq::MODULUS;
        exponent.add_with_carry(&<Fq as PrimeField>::BigInt::from(1_u64));
        exponent.div2();
        exponent.div2();
        let root = input.pow(exponent);
        let decision = root.square() == input;
        let a0 = input.square() + Fq::from(4);
        let a1 = input * Z0;
        let inverse = (a0 * a1).inverse().unwrap_or(Fq::from(0));
        let x1 = Z1 - input * a1.square() * inverse;
        for x in [
            x1,
            -(x1 + Fq::from(1)),
            a0.square().square() * inverse.square() + Fq::from(1),
        ] {
            let curve = x.square() * x + Fq::from(3);
            let mut y = curve.pow(exponent);
            if y.square() != curve {
                continue;
            }
            if !decision {
                y = -y;
            }
            let mut out = [0; 64];
            out[..32].copy_from_slice(&bytes(x));
            out[32..].copy_from_slice(&bytes(y));
            return out;
        }
        panic!("reference map failed");
    }

    #[test]
    fn witnesses_reproduce_the_original_exponentiation_for_all_branches() {
        let document: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/vectors.json")).unwrap();
        let mut cases = std::collections::BTreeSet::new();
        for vector in document["vectors"].as_array().unwrap() {
            let compact = hex::decode(vector["compactHex"].as_str().unwrap()).unwrap();
            let witnesses = hex::decode(vector["witnessHex"].as_str().unwrap()).unwrap();
            let inputs = hash_to_field(compact[46..78].try_into().unwrap(), &CANONICAL_DOMAIN);
            for i in 0..2 {
                let hints = &witnesses[i * 162..(i + 1) * 162];
                assert_eq!(
                    map_to_point(inputs[i], hints).unwrap(),
                    reference_map(inputs[i])
                );
                cases.insert((i, hints[0], hints[1]));
                // Canonical field decoding must reject modulo aliases.
                for offset in [2, 34, 66, 98, 130] {
                    let mut alias = hints.to_vec();
                    alias[offset..offset + 32].copy_from_slice(&MODULUS);
                    assert_eq!(map_to_point(inputs[i], &alias), Err(Error::Witness));
                }
            }
        }
        assert_eq!(cases.len(), 12);
    }
}

/// Validate a governance-configured public key before accepting it as trust.
pub fn validate_public_key(key: &[u8; 128]) -> Result<(), Error> {
    if key.iter().all(|byte| *byte == 0) {
        return Err(Error::Committee);
    }
    let mut input = [0; 384];
    input[31] = 1;
    input[63] = 2;
    input[64..192].copy_from_slice(key);
    input[223] = 1;
    let minus_two = -Fq::from(2);
    input[224..256].copy_from_slice(&bytes(minus_two));
    input[256..].copy_from_slice(key);
    let result = alt_bn128_pairing_be(&input).map_err(|_| Error::Committee)?;
    let mut expected = [0; 32];
    expected[31] = 1;
    if result.as_slice() != expected {
        return Err(Error::Committee);
    }
    Ok(())
}

#[cfg(test)]
mod key_tests {
    use super::*;
    #[test]
    fn configured_keys_reject_identity_off_curve_and_noncanonical_encodings() {
        validate_public_key(&CANONICAL_PUBLIC_KEY).unwrap();
        assert_eq!(validate_public_key(&[0; 128]), Err(Error::Committee));
        assert_eq!(validate_public_key(&[255; 128]), Err(Error::Committee));
        let mut malformed = CANONICAL_PUBLIC_KEY;
        malformed[..32].copy_from_slice(&MODULUS);
        assert_eq!(validate_public_key(&malformed), Err(Error::Committee));
    }
}
