# Pair support

The verifier is pair-independent within its supported encoding: one explicitly
selected `u32` pair ID, one committee, one 38-byte quote, and at most 16 sorted
Merkle siblings. A positive `u128` price and 0–18 decimals are supported. It does
not maintain a list of accepted IDs or map asset names during authentication.
New pair IDs need no crate release if the same format and configured trust apply.

Every call requires an expected pair. `Proof::verify(expected_pair)` uses the
historical committee-1 default. For another independently authenticated trust,
use `verify_with(expected_pair, committee, key, domain)`. For example, the bundled
historical committee-0 configuration can authenticate the captured SOL/USDT proof:

```rust
use supra_verifier_solana::{crypto, Error, Proof, VerifiedQuote};

fn authenticate_sol_usdt(bytes: &[u8]) -> Result<VerifiedQuote<'_>, Error> {
    Proof::decode(bytes)?.verify_with(
        10,
        0,
        &crypto::HISTORICAL_COMMITTEE_0_PUBLIC_KEY,
        &crypto::CANONICAL_DOMAIN,
    )
}
```

These are historical key snapshots, not ongoing authorization guarantees. Never
load keys from a proof response or infer them from the catalog. Authenticate trust
configuration independently. Caller-selected pair and trust must be bound to the
application's authenticated state; a valid proof for another pair is rejected.

The companion JS tooling exposes `SUPRA_COMMITTEE_0_TRUST` for the same explicit
choice: `verifySupraProof(compact, 10, SUPRA_COMMITTEE_0_TRUST)`. Its default stays
committee 1. Pass the selected domain to `encodeProof` when generating witnesses
for a different domain; packing and witness generation do not authenticate data.

## Authenticated regression coverage

The original BTC/USD pair-18 vectors remain unchanged. New original public proofs
were checked locally and accepted by the read-only EVM reference verifier:

| Pair ID | Catalog symbol | Selected committee | Decimals | Merkle depth |
| ---: | --- | ---: | ---: | ---: |
| 0 | BTC_USDT | 0 | 18 | 9 |
| 1 | ETH_USDT | 0 | 18 | 9 |
| 10 | SOL_USDT | 0 | 18 | 9 |
| 19 | ETH_USD | 1 | 8 | 8 |
| 48 | USDT_USD | 1 | 8 | 8 |
| 185 | USDY_USD | 0 | 18 | 9 |
| 5000 | EUR_USD | 1 | 18 | 8 |
| 6000 | TSLA_USD | 1 | 18 | 8 |

Proofs, original response bodies and reference results are in
[fixtures/pairs.json](../fixtures/pairs.json); capture and trust evidence is in
[provenance.md](provenance.md). Tests check preservation of all signed fields,
prices wider than `u64`, cross-pair substitution, altered pair IDs and committee
mismatches. No observation is retimed or re-signed to create this coverage.

This is evidence for these vectors and formats. It does not establish that every
listed feed is available, currently authorized, or suitable for a particular
application. Different leaf layouts, numeric ranges, multi-leaf proofs and
multi-committee batches remain unsupported. A bounded Merkle path also does not
guarantee that every consumer transaction fits Solana's packet or compute limits.

## Optional catalog

[catalog/pairs.json](../catalog/pairs.json) is a versioned, dated metadata snapshot
of the [official Supra list](https://docs.supra.com/oracles/data-feeds/data-feeds-index).
It contains unambiguous `pairs` entries (`id`, `symbol`, `name`, `status`) and a
separate `conflicts` list. Status is informational: `premium`, `standard`,
`under-supervision`, `deprecated` or `coming-soon`. It is not a cryptographic
allowlist, a trust registry, a trading calendar or a promise of live proof access.

The captured source assigns ID **539** to both `hSUITE_HBAR` (deprecated) and
`stSUI_SUI` (premium). That ID appears only in `conflicts`; the snapshot does not
choose a symbol. Consumers must resolve such ambiguity independently before
binding a name to an expected numeric ID.

Read this optional JSON for symbol/status lookup, or use numeric IDs directly.
Refresh explicitly with `npm run catalog:update` and review the diff. No import,
test or CI workflow refreshes it or uses it to accept a key. Application-specific
freshness, market hours, deprecation handling and lifecycle policy remain outside
cryptographic verification.
