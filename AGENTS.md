# Working on supra-verifier-solana

This is an independent, unaudited Supra BTC/USD verifier and its local tools.

- Preserve original signatures, signed milliseconds, public fixtures and their
  provenance. Never retime observations or learn trust from proof responses.
- Scope is pair 18, one committee/leaf and a bounded sorted Merkle path. Broader
  support requires authenticated vectors and an explicit API decision.
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
