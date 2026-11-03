# Changelog

## 0.1.0 — 2026-11-03

- Provide an independent pair-bound Supra BLS/Merkle verifier for Solana programs.
- Retain original public proof vectors, committee provenance and MIT attribution.
- Provide a borrowed decoder with private fields and typed authenticated quotes.
- Include local TypeScript codec/witness tools and an exact-second Solana example.
- Add offline checks, isolated Surfpool integration and release-package validation.
- Check the minimum supported Rust version and standalone dependency use in CI.
- Pin CI actions by commit and review dependency updates through Dependabot.
- Require an explicit expected pair in Rust/JS verification and codec tooling.
- Preserve eight original cross-asset proofs, independently checked by EVM eth_call,
  covering both historical committees and 8/18-decimal unsigned prices.
- Expose historical committee 0 as explicit trust while retaining committee-1 defaults.
- Include an optional dated pair catalog with unresolved source conflicts separated.
- Extend confirmed Solana tests to original non-BTC proofs and cross-pair substitution.
