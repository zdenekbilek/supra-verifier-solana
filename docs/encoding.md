# Supported encoding

The current codec supports one committee and one explicitly selected price leaf from Supra's
EVM-ABI pull-proof response. It removes ABI padding without changing signed data.
Multi-committee, multi-leaf and nonzero multiproof flags are rejected.

## Rust verifier input

| Field | Bytes | Encoding |
| --- | ---: | --- |
| Committee ID | 8 | Unsigned little endian |
| Quote | 38 | Packed fields below |
| Merkle root | 32 | Original hash bytes |
| BLS signature | 64 | G1 x, y; canonical big-endian fields |
| Merkle depth | 1 | 0 through 16 |
| Siblings | 32 × depth | Sorted-pair Keccak path |
| Arithmetic witnesses | 324 | Two checked 162-byte mapping hints |

The packed quote is pair `u32`, price `u128`, observation Unix milliseconds
`u64`, decimals `u16`, and oracle round `u64`, all little endian.
The Merkle leaf is Keccak-256 of those original 38 bytes. Every parent is
Keccak-256 of its two hashes concatenated in lexicographic order.

The compact portion is `143 + 32 * depth` bytes. The Rust input includes the
witnesses and is `467 + 32 * depth` bytes. It rejects truncation and trailing data.
The captured depth-8 fixture has 399 compact bytes and 723 Rust-input bytes.

`compactProof` produces only the compact portion. `encodeProof` appends witnesses.
Witnesses are generated from the root and selected signing domain; they are not
signatures, credentials or trusted assertions. The Rust verifier checks their
equations, canonical field encodings and deterministic mapping branches before
performing the original BN254 pairing verification.

## Example instruction

The stateless example prepends expected pair `u32`, expected committee `u64`,
expected Unix second `u64` and previous observation Unix milliseconds `u64`, all
little endian. This 28-byte prefix belongs to the example, not to `Proof::decode`. `tools/proof.ts::instructionData` creates this
example-specific envelope. The pair and committee must be selected explicitly. The expected timestamp uses **seconds**, while the
previous timestamp and original signed observation use **milliseconds**.

The example returns only the original 38 quote bytes. Committee and trust must
be known to the consumer separately. The library's `VerifiedQuote` retains its
verified committee ID in addition to the quote bytes.
