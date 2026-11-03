# Working on supra-verifier-solana

This is an independent, unaudited, pair-bound Supra verifier and its local tools.

- Preserve original signatures, signed milliseconds, public fixtures and their
  provenance. Never retime observations or learn trust from proof responses.
- Scope is one explicitly selected u32 pair, one committee/leaf and a bounded
  sorted Merkle path. Generic single-pair support was authorized on 2026-11-03;
  original cross-asset proofs must remain authenticated under independently
  captured trust. Batch or new encoding support requires vectors and an API decision.
- Require the expected pair in Rust and JS verification calls. Catalog metadata
  never supplies trust; retain conflicting listings explicitly. Default trust
  remains historical committee 1; committee 0 is an explicit configuration option.
- Keep cryptographic verification separate from application timing/lifecycle.
  Decoding is not authentication; only successful verification returns a quote.
- Retain upstream MIT attribution in NOTICE and source hashes in provenance docs.
- Do not copy game secrets, env files, wallets or deployment configuration here.
- The integration harness owns an offline loopback Surfpool with disposable
  keys. Historical Clock replay must remain confined to that harness.
- After code changes run `npm run check:release -- --allow-dirty`. For changes to
  verifier execution, encoding, dependencies or the harness also run
  `npm run test:integration`. Run clean release checks before actual publication.
- Keep expensive Docker/SBF CI manual-only. Do not enable automatic publication
  or public-cluster deployment without a maintainer request.
- Dependency overrides are explained in docs/maintenance.md. Recheck them with
  `npm ci` and confirmed RPC integration after changes.
