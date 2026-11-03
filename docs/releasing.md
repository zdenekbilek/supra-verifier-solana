# Releasing

The Rust package is `supra-verifier-solana`. The npm manifest is private tooling
and the example has `publish = false`. A GitHub push, tag or workflow does not
publish anything to crates.io. No workflow deploys a public Solana program.

## Release checklist

1. Review the API, single-pair scope, explicit feed binding, historical trust assumptions, attribution
   and [integration responsibilities](integration.md). The package is unaudited.
2. Confirm the registry name is available; availability is not reserved by a dry
   run. The extraction checked the crates.io API on 2026-11-03 and received 404.
3. Run `npm ci` with Node 22 or newer and `npm run check:release` from a clean
   commit. For work-in-progress inspection only, pass `-- --allow-dirty`.
   This checks formatting, Clippy, native/doc/JS tests, TypeScript, rustdoc,
   fixture hashes, the package allowlist, a Cargo publish dry run, tests in
   an independently extracted archive and a separate workspace using that archive
   as a renamed dependency. It never uploads a crate. Also run
   `cargo +1.89.0 test --workspace --locked` to check the declared minimum Rust.
4. Run `npm run test:integration` with Docker, Rust and Solana CLI/build tools.
   The SBF tools version is v1.57 / SBPF v0. Review `target/results.json` for
   confirmed successes, expected rejections, compute units and packet sizes.
   The GitHub integration workflow is manual-only to limit Actions usage.
5. Update CHANGELOG and README release status, commit the exact release content,
   and rerun checks. Ensure the published commit has no local modifications.

6. Review [generic pair coverage](pairs.md), the catalog's unresolved conflicts,
   and the new authenticated-vector provenance. Do not claim every listed pair is
   available. Require every consumer verification call to select its expected pair.

## Publish explicitly

Create a crates.io account, verify its email and create a publishing token.
Authenticate locally with `cargo login`; enter the token at its prompt rather
than placing it in shell arguments, source files, logs or chat.

```sh
cargo publish --package supra-verifier-solana --registry crates-io --locked
git tag -a v0.1.0 -m 'Release 0.1.0'
git push origin v0.1.0
```

Run the publish command only when the maintainer intends to release. Each new
release needs a new version; an existing name/version cannot be overwritten.
Inspect the crates.io entry and docs.rs build, and test a fresh consumer using
the registry version. Record the release notes on GitHub. Replace the README's
unreleased badge with `https://img.shields.io/crates/v/supra-verifier-solana.svg`
linked to the crate page, add the docs.rs badge after its build succeeds, and
replace the primary path dependency example with the published version.

For later releases, bump the version, refresh Cargo.lock, update CHANGELOG and
repeat these checks. Trusted Publishing can be configured after the initial
manual release to use short-lived CI credentials. This repository deliberately
does not enable automatic publication during extraction.

See [Cargo publishing](https://doc.rust-lang.org/cargo/reference/publishing.html)
and [Trusted Publishing](https://crates.io/docs/trusted-publishing).
