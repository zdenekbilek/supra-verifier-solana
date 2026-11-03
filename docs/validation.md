# Extraction validation — 2026-11-03

The standalone extraction was checked locally with Rust/Cargo **1.97.1**, Node
**22.22.2**, SBF platform tools **v1.57 / SBPF v0**, and the digest-pinned Surfpool
image in `examples/verify-proof/run.mjs`. The local Solana CLI wrapper was 2.2.7;
the manual integration workflow installs CLI 4.1.2. These are local results,
not a claim that the manual GitHub integration workflow has run.

`npm run check:release -- --allow-dirty` passed formatting, Clippy with warnings
denied, TypeScript checks, rustdoc, **12 library tests**, **2 example-policy
tests**, **1 doctest**, and **6 Node tests**. Cargo's publish dry run passed
without uploading anything. The generated archive was unpacked outside the
checkout and its **12 library tests and 1 doctest** passed independently.
The package file allowlist and all original fixture hashes passed verification.
`npm ci` completed and the Node dependency audit reported zero vulnerabilities.

The fixture-only confirmed Solana run completed at
**2026-11-03 10:55:44 UTC**:

| Measurement | Result |
| --- | ---: |
| Confirmed transactions | 40 |
| Accepted proofs/policy cases | 12 |
| Expected rejections | 28 |
| Accepted compute units | 359,889–406,563 |
| Largest accepted transaction | 949 bytes |
| Compiled example program | 170,232 bytes |

Example binary SHA-256:
`fd56448a23570de26ed817b529058fe78392122ff63f142a5d6a90068da704ac`.
Full per-transaction local evidence is in ignored `target/results.json` and can
be regenerated with `npm run test:integration`. The harness confirmed successful
return-data provenance and quote bytes, as well as expected failures for altered
fields, invalid signatures/witnesses, unsupported feeds, neighboring seconds,
future/stale observations, ordering, malformed encoding and unexpected accounts.

No fresh public proof was requested for this extraction run. All signed fixture
observations and their original timestamps were retained unchanged. Historical
Clock replay and every submission were confined to the disposable scratch chain.
These checks establish regression/integration coverage, not an independent
cryptographic security audit or a production availability guarantee.
