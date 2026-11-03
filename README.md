# supra-verifier-solana

Independent verification of **Supra BTC/USD pull-oracle proofs on Solana**.
The Rust library checks the original BN254 BLS signature, sorted Merkle inclusion
and packed quote fields. It uses checked, untrusted arithmetic witnesses to fit
the hash-to-curve calculation into Solana's compute budget.

This is a community implementation, not an official Supra SDK or deployment.
It has regression tests and public vectors, but **has not received an independent
security audit**. Version 0.1.0 is being prepared; it has not been published yet.

## Scope and trust

- BTC/USD **pair 18** only, with one committee, one leaf and at most 16 siblings.
  BTC/USDT is a different feed and is rejected. Multi-leaf proofs are unsupported.
- Integer `u128` prices, at most 18 decimals and original millisecond timestamps.
- A historical, independently read committee-1 public key and domain are bundled.
  They are a snapshot, not an assurance that the key remains authorized today.
- `verify_with` accepts application-configured trust. Authenticate replacements
  independently and validate keys before storing configuration. Never derive
  trust from the proof response itself.
- The library authenticates observations; it does not check Clock, freshness,
  settlement deadlines, observation ordering, replay state or governance.

See [integration](docs/integration.md), [encoding](docs/encoding.md) and
[source/key provenance](docs/provenance.md).

## Rust usage

Before the first registry release, use a local dependency:

```toml
[dependencies]
supra-verifier-solana = { path = "../supra-verifier-solana" }
```

The input is the compact proof followed by 324 witness bytes, produced by the
companion tools. Decoding alone does not authenticate anything. Only successful
verification returns a typed quote:

```rust
use supra_verifier_solana::{Error, Proof, VerifiedQuote};

fn authenticate(bytes: &[u8]) -> Result<VerifiedQuote<'_>, Error> {
    let proof = Proof::decode(bytes)?;
    let quote = proof.verify()?;
    // Enforce your application's time, ordering and lifecycle rules here.
    // quote.price() / 10^quote.decimals() is the USD value; keep integer math.
    Ok(quote)
}
```

The quote exposes `pair()`, `price()`, `decimals()`, `timestamp_ms()`,
`oracle_round()`, `committee()` and its original `as_bytes()`.
Applications with an existing error namespace should map `Error` explicitly;
the convenience conversion to `ProgramError` uses codes 1 through 12.

## Companion tools

The Git repository contains private Node tooling, not a separately published npm
package. Use Node 22 or newer and install its pinned dependencies with `npm ci`.
These tools are not included in the Rust `.crate` archive.

```ts
import { compactProof, encodeProof, verifySupraProof } from './tools/proof.js';

// `proofHex` is original Supra EVM-ABI proof data supplied by your collector.
const compact = compactProof(proofHex);
const authenticated = verifySupraProof(compact);
const rustInput = encodeProof(compact); // compact bytes + checked witnesses
```

Run TypeScript with `node --import tsx`, using `.ts` for direct file imports in
an executable script. Merely packing bytes or generating witnesses does not
authenticate them. `verifySupraProof` independently verifies the signature in JS.
Price strings preserve the full unsigned integer; timestamps exposed as JS
numbers must fit `Number.MAX_SAFE_INTEGER`.

`fetchProof` makes an explicit request to Supra's public proof endpoint, with
a ten-second timeout. Nothing fetches automatically when imported. Endpoint
availability does not establish free production access or an availability SLA;
arrange access with Supra independently. Trust is never loaded from that response.

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

Lightweight CI runs native, JS and packaging checks. Docker/SBF integration is
manual-only. No workflow publishes a package or deploys to a public cluster.

## Release and license

Run `npm run check:release` from a clean commit to validate the shipped archive,
including its tests from an extracted copy. During local editing, use
`npm run check:release -- --allow-dirty`. See [release steps](docs/releasing.md).

MIT; see [LICENSE](LICENSE). The adapted Supra algorithm's MIT attribution and
source provenance are preserved in [NOTICE](NOTICE) and
[docs/provenance.md](docs/provenance.md).
