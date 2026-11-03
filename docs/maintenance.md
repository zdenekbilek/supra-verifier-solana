# Dependency choices

The Rust dependency versions are retained from the original shared verifier.
Cargo.lock preserves the original experiment's resolved dependencies, adding
only the native fixture-test dependencies needed by this workspace. Native CI
uses Rust 1.97.1; SBF compilation pins platform tools v1.57 and SBPF v0. A minimum
supported Rust version has not been established separately.

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
