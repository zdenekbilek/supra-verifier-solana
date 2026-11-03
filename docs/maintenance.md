# Dependency choices

The Rust dependency versions are retained from the original shared verifier.
Cargo.lock preserves the original experiment's resolved dependencies, adding
only the native fixture-test dependencies needed by this workspace. Native CI
uses Rust 1.97.1; a separate CI job tests the minimum supported Rust **1.89**.
SBF compilation pins platform tools v1.57 and SBPF v0. The SBF toolchain is
separate from the native minimum and must also pass confirmed integration.

GitHub Actions use full commit SHAs with release-version comments. Dependabot
opens weekly review requests for Actions, Cargo and npm updates; nothing merges
or publishes automatically. Keep the minimum-Rust job aligned with `rust-version`
in Cargo.toml. Review action release notes and runtime requirements before updating
the pins. Only the manual integration workflow installs Solana and runs Docker/SBF.
See GitHub's [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
and [Cargo's manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html)
for action pinning and package metadata requirements.

The private Node tooling pins Noble curves/hashes and Solana web3.js. Its npm
overrides are intentional:

- `@solana/web3.js` uses `jayson` **5.0.0** to remove vulnerable `uuid` and
  `stream-json` transitive dependencies. Jayson's documented v5 changes affect
  UUID generation and TCP/TLS framing; this harness uses HTTP JSON-RPC and the
  web3.js browser-client request builder, not those transports. The confirmed
  integration run validates the actual RPC path.
- `rpc-websockets@^9.0.0` is pinned to **9.3.8**, preserving the web3.js v1
  SDK/CommonJS compatibility choice from the source application.

After dependency changes, regenerate the relevant lockfile, run `npm ci`, native
checks and the confirmed integration harness. Do not apply `npm audit fix
--force` blindly across Solana SDK major versions. Node dependencies are not
part of the Rust crate's dependency graph or its registry archive.
