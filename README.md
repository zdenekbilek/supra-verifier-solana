# supra-verifier-solana

[![CI](https://github.com/zdenekbilek/supra-verifier-solana/actions/workflows/ci.yml/badge.svg)](https://github.com/zdenekbilek/supra-verifier-solana/actions/workflows/ci.yml)
[![Rust 1.89+](https://img.shields.io/badge/rust-1.89%2B-93450a)](Cargo.toml)
[![crates.io](https://img.shields.io/crates/v/supra-verifier-solana.svg)](https://crates.io/crates/supra-verifier-solana)
[![docs.rs](https://docs.rs/supra-verifier-solana/badge.svg)](https://docs.rs/supra-verifier-solana/0.1.0/supra_verifier_solana/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Independent verification of **pair-bound Supra pull-oracle proofs on Solana**.
The Rust library checks the original BN254 BLS signature, sorted Merkle inclusion
and packed quote fields. It uses checked, untrusted arithmetic witnesses to fit
the hash-to-curve calculation into Solana's compute budget.

This is a community implementation, not an official Supra SDK or deployment.
It has regression tests and public vectors, but **has not received an independent
security audit**. Version **0.1.0** is the initial release.

## Scope and trust

- Any explicitly selected `u32` pair ID using the supported 38-byte leaf format,
  with one committee, one leaf and at most 16 siblings. Multi-leaf proofs are
  unsupported. A valid proof for another feed is rejected.
- Integer `u128` prices, at most 18 decimals and original millisecond timestamps.
- The default remains a historical, independently read committee-1 key/domain.
  Committee 0 is bundled as an explicit configuration option. These snapshots do
  not assure that either key remains authorized today.
- `verify_with(expected_pair, committee, key, domain)` accepts configured trust. Authenticate replacements
  independently and validate keys before storing configuration. Never derive
  trust from the proof response itself.
- The library authenticates observations; it does not check Clock, freshness,
  settlement deadlines, observation ordering, replay state or governance.

See [integration](docs/integration.md), [encoding](docs/encoding.md) and
[source/key provenance](docs/provenance.md). See [pair support and catalog](docs/pairs.md)
for tested coverage and the limits of the generic format.

## Rust usage

Add the registry dependency:

```toml
[dependencies]
supra-verifier-solana = "0.1.0"
```

The input is the compact proof followed by 324 witness bytes, produced by the
companion tools. Decoding alone does not authenticate anything. Only successful
verification returns a typed quote:

```rust
use supra_verifier_solana::{Error, Proof, VerifiedQuote};

fn authenticate(bytes: &[u8], expected_pair: u32) -> Result<VerifiedQuote<'_>, Error> {
    let proof = Proof::decode(bytes)?;
    let quote = proof.verify(expected_pair)?;
    // Enforce your application's time, ordering and lifecycle rules here.
    // price / 10^decimals is in the pair's quote asset; keep integer math.
    Ok(quote)
}
```

The quote exposes `pair()`, `price()`, `decimals()`, `timestamp_ms()`,
`oracle_round()`, `committee()` and its original `as_bytes()`.
Applications with an existing error namespace should map `Error` explicitly;
the convenience conversion to `ProgramError` uses codes 1 through 12.

Rust **1.89 or newer** is required and checked in CI. The library has no Anchor
dependency, program ID, accounts, instruction envelope or application state.
It can be called directly from an existing Solana/Anchor program. See the
[consumer migration guide](docs/integration.md#existing-consumers) for a renamed
dependency, configurable trust, checked price conversion and error mapping.

## Companion tools

The Git repository contains private Node tooling, not a separately published npm
package. Use Node 22 or newer and install its pinned dependencies with `npm ci`.
These tools are not included in the Rust `.crate` archive.

```ts
import { compactProof, encodeProof, verifySupraProof } from './tools/proof.js';

// `proofHex` is original Supra EVM-ABI proof data supplied by your collector.
const expectedPair = 19; // Application-selected ETH/USD; never inferred from the proof.
const compact = compactProof(proofHex, expectedPair);
const authenticated = verifySupraProof(compact, expectedPair);
const rustInput = encodeProof(compact, expectedPair); // compact bytes + checked witnesses
```

Run TypeScript with `node --import tsx`, using `.ts` for direct file imports in
an executable script. Merely packing bytes or generating witnesses does not
authenticate them. `verifySupraProof` independently verifies the signature in JS.
Price strings preserve the full unsigned integer; timestamps exposed as JS
numbers must fit `Number.MAX_SAFE_INTEGER`.

`fetchProof(expectedPair, signal?)` makes an explicit request to Supra's public proof endpoint, with
a ten-second timeout. Nothing fetches automatically when imported. Endpoint
availability does not establish free production access or an availability SLA;
arrange access with Supra independently. Trust is never loaded from that response.

## Pair catalog and fixtures

[catalog/pairs.json](catalog/pairs.json) is an optional, dated symbol/status
snapshot of the official feed list. It is not a verification allowlist or a trust
source. Conflicting source listings are stored separately instead of choosing a
symbol automatically. New IDs do not require a library update if their format
and independently configured trust are supported.

`fixtures/pairs.json` preserves eight original cross-asset responses, all accepted
by the read-only Arbitrum reference verifier and checked locally. It is regression
coverage, not a claim that every catalog listing is available or validated.
Explicit maintenance commands (never run automatically in tests or imports):

```sh
npm run catalog:update
npm run fixtures:capture -- 0 1 10 19 185 5000 6000 48
```

Capture writes candidates under ignored `target/`; review provenance and hashes
before promoting new fixtures. See [pair support](docs/pairs.md).

## Verify locally

```sh
npm ci
npm run typecheck
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo doc --no-deps --locked
```

For confirmed on-chain execution in a disposable, offline Surfpool:

```sh
npm run test:integration
# Optional: one public proof request, still submitted only to the scratch chain.
npm run test:integration -- --live
```

The integration command needs Docker, Rust, `cargo-build-sbf` and `solana` on
PATH. It builds with platform tools **v1.57 / SBPF v0**, starts a digest-pinned
Surfpool on random loopback ports, and generates disposable wallets. It never
loads `.env`, the default Solana wallet, or a supplied external RPC. Fixture
timestamps are unchanged; historical Clock replay occurs only on its own scratch
chain. Cleanup stops that container and deletes generated wallets.

The example enforces an **exact second**, never the older experiment's ±3-second
window. Its timing arguments are caller supplied because it has no state; it is
not a settlement program or a persistent replay guard. See
[the example](examples/verify-proof/README.md). Results and compute measurements
are written under ignored `target/`; no historical benchmark is presented as a
measurement of this release.

Lightweight CI runs native, JS, minimum-Rust and packaging checks, including a
separate consumer of the extracted crate, and retains the checked `.crate` as
an artifact. Actions are pinned by commit; Dependabot proposes dependency and
action updates for review. Docker/SBF integration is manual-only. No workflow
publishes a package or deploys to a public cluster.

## Release and license

Run `npm run check:release` from a clean commit to validate the shipped archive,
including its tests from an extracted copy. During local editing, use
`npm run check:release -- --allow-dirty`. See [release steps](docs/releasing.md).

MIT; see [LICENSE](LICENSE). The adapted Supra algorithm's MIT attribution and
source provenance are preserved in [NOTICE](NOTICE) and
[docs/provenance.md](docs/provenance.md).
