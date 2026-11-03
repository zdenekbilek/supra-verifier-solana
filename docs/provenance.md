# Source, fixture and trust provenance

Extracted on 2026-11-03 from the Bull or Bear source checkout at commit
`bab42f4247b140ee44b33b11bd54d3f1618d039f`. The Rust crate originated in
`anchor/crates/supra-verifier`; the isolated harness originated in
`experiments/supra-verifier`; the companion algorithms originated in
`shared/supra.ts`, `shared/supra-crypto.ts` and `shared/oracle-identity.ts`.
No game accounts, operator keys, environment files or deployment configuration
are needed by this repository.

The standalone extraction uses MIT for the maintainer's contributions. Preserve
the upstream algorithm attribution in [NOTICE](../NOTICE). The port has not
received an independent security audit.

## Independently inspected verifier

- [Supra pull protocol](https://docs.supra.com/oracles/data-feeds/pull-oracle),
  [feed index](https://docs.supra.com/oracles/data-feeds/data-feeds-index), and
  [published networks](https://docs.supra.com/oracles/data-feeds/pull-oracle/networks).
- Arbitrum chain **42161**, historical block **520356155**.
- Pull proxy: `0x41AB2059bAA4b73E9A3f55D30Dff27179e0eA181`.
- Pull implementation: `0x76f98f247a3cf0d1293605a868f78662b030c683`.
- BLS verifier proxy: `0x1643EeCDAc472c8382229d5f641ac778C4cb3FBE`.
- BLS implementation: `0x02B70DDe7a8B0Ca5f2a1118Bb6e5C48EC0793944`.
- [Verified BLS source/metadata](https://sourcify.dev/server/v2/contract/42161/0x02B70DDe7a8B0Ca5f2a1118Bb6e5C48EC0793944?fields=all).

The inspected `BLS.sol` and `SupraSValueFeedVerifier.sol` sources identify their
license as MIT, without a separate copyright notice. SHA-256 hashes of the
inspected source text were recorded as:

| Source | SHA-256 |
| --- | --- |
| `BLS.sol` | `5412e26866daf40eb20cd52e20e88da9a364a5a4ea478d66768197b7891e5319` |
| `SupraSValueFeedVerifier.sol` | `d9e8a37a61dc9d8031cc5dd1fd4c1648b03cd401172032269d2470377981cd12` |

The FT mapping, SHA-256 expansion and BN254/domain constants are adapted from
that MIT-identified algorithm. The checked-arithmetic witness optimization and
compact codec were independently written. The inspected pull implementation is
marked `UNLICENSED`; it was consulted for factual wire-layout and leaf-hash
compatibility, and its implementation was not copied.

## Fixtures and key snapshot

`fixtures/committee.json` preserves the independently read committee/domain
snapshot at the block above. The domain is a public signature separator, not a
secret. Rust and TypeScript pin committee **1**; the fixture also records the
other committee read during the inspection. It is historical evidence and must
not be treated as a dynamic trust source.

`btc-usd.json` preserves an original public response captured on
**2026-11-01 at 18:47:29.769 UTC**, its compact bytes and arithmetic witnesses.
Its recorded `boundaryMs` is historical experiment metadata; the new exact-second
harness derives its test second from the unchanged signed timestamp, not from
that older ±3-second experiment boundary.

`vectors.json` preserves original proofs previously accepted by the Arbitrum
pull verifier through read-only `eth_call`. They cover all 12 combinations of
mapped-point index, Legendre decision and selected mapping branch. Native tests
also compare the optimized mapping with an exponentiation-based reference.
Those original inspection results are retained provenance, not a new audit or a
claim that this extraction re-ran the historical EVM calls.

`forged-tree.json` is deliberately adversarial: an internally consistent Merkle
tree with an unrelated signature. It is not an authenticated Supra price.
All four JSON fixtures are copied byte for byte; their SHA-256 hashes are in
`fixtures/SHA256SUMS`. Never retime signed observations or replace pinned trust
with a key from an untrusted price response.
