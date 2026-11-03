# Extraction validation — 2026-11-03

## Generic single-pair verification — 2026-11-03

The generic API passed release checks with a fresh extracted-package build,
Clippy/rustdoc/formatting, **13 library tests**, **1 public-API consumer test**,
**2 example-policy tests**, **1 doctest**, **10 Node tests**, TypeScript checks,
fixture hashes, packaging and a Cargo publish dry run. Minimum Rust **1.89**
workspace tests passed. Nothing was uploaded.

Eight original cross-asset responses were authenticated against the independently
captured committee-0/1 keys and accepted by read-only EVM calls; every signed
field matched. See [provenance](provenance.md) and [coverage](pairs.md). The four
original JSON fixtures remain byte-for-byte unchanged.

The fixture-only Solana run completed at **2026-11-03 16:00:51 UTC**:

| Measurement | Result |
| --- | ---: |
| Confirmed transactions | 72 |
| Accepted proofs/policy cases | 20 |
| Expected rejections | 52 |
| Maximum accepted compute | 406,589 units |
| Largest accepted transaction | 993 bytes |
| Compiled example program | 170,656 bytes |

New confirmed cases cover each authentic cross-asset quote, valid cross-pair
substitution, pair-byte mutation and committee mismatch. They use the new
28-byte example envelope; the compact proof and signed data formats are unchanged.
Historical Clock replay and all Solana submissions remain confined to the
harness-owned offline scratch chain. These results are local, not a GitHub
workflow run or an independent security audit.

## Release preparation review — 2026-11-03

The follow-up review passed `npm ci` (zero reported vulnerabilities),
`npm run check:release -- --allow-dirty`, and
`cargo +1.89.0 test --workspace --locked`. In addition to the original suites
below, one public-API consumer test runs in the workspace, the extracted package
and a separate workspace importing the extracted crate under a renamed dependency.
The declared Rust minimum is now 1.89. No cryptographic implementation or original
fixture bytes changed during this review.
The release checks also passed with the CI Node version, **22.22.2**, and the
workflows passed actionlint **1.7.12** locally.

The repeated fixture-only Solana run completed at **2026-11-03 15:21:48 UTC**:
40 confirmed transactions, 12 accepted proofs/policy cases, 28 expected rejections,
maximum accepted compute 406,563 units and maximum accepted transaction 949 bytes.
The example binary remains 170,232 bytes. This evidence is local; the edited
GitHub workflows still require execution on GitHub. Nothing was published.

## Original extraction checks

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
