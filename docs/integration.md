# Integration responsibilities

`Proof::decode` checks byte structure only. `Proof::verify` checks BTC/USD fields,
Merkle inclusion and the BLS signature under the historical default trust.
`verify_with` uses trust that your application must authenticate independently.
Neither function reads Clock or application state. `VerifiedQuote` means the
observation is authentic under the selected trust; it does not authorize a bet,
payment or settlement.

## Time and state

Derive any expected timestamp, previous observation and settlement deadline from
authenticated application accounts. Preserve the oracle's original signed
milliseconds. For an exact-second policy with scheduled second `s`, accept only
timestamps in `[s * 1000, s * 1000 + 999]`, with checked integer arithmetic.
Never substitute a neighboring second or alter the signed timestamp.

Solana Clock has whole-second precision. An observation at `s * 1000 + 138` is
still in the future while Clock equals `s`; submit after chain time catches up.
Also enforce freshness, ordering, one transition per round, refund deadlines
and any application-specific obligations independently. A missing acceptable
proof should follow the application's declared failure/refund policy.

The bundled stateless example demonstrates an exact second, future rejection,
30-minute maximum age and a previous-timestamp argument. Those arguments are
untrusted instruction inputs in this example. They must come from application
state in a real integration, where previous timestamps and transition state must
also be persisted. The example is not a drop-in settlement service.

## Trust and rotation

The bundled key/domain came from a historical Arbitrum verifier snapshot, not
the quote endpoint. Arbitrum is not consulted during verification and is not a
price authority for the Solana program. Confirm the current authorization of any
key independently before relying on it.

For configurable trust, call `crypto::validate_public_key` before accepting a
configuration update. This checks encoding, curve membership, subgroup and
identity rejection; it does not establish who controls the key. Authenticate the
committee ID, key and domain through independent evidence, and authorize updates
through your application's governance. Bind outstanding obligations to their
intended trust (for example using `crypto::trust_hash`) rather than silently
switching their authority when configuration changes.

The library has no automatic rotation, revocation, upstream trust discovery,
upgrade policy or API availability guarantee. An unknown committee fails closed.
The oracle committee remains the price authority: a valid signature does not
prove an exchange trade occurred or establish economic accuracy.

## Solana execution

Use the Rust library directly inside your program, or build a verifier program
with an explicit interface. The example accepts no accounts and returns exactly
38 authenticated quote bytes. A CPI consumer must verify the return-data program
ID, bind the called program/upgrade authority to its trust model, and parse only
the expected return bytes from the successful invocation.

Check transaction size and compute with your actual account list and instructions.
The 16-sibling codec limit is not a promise that every application transaction
fits a packet. Request the compute budget appropriate for the measured path.
No frontend or API verification flag can substitute for on-chain verification.

`crypto` exposes lower-level primitives for review and reuse. Merkle verification
alone does not authenticate a root; root-signature verification alone does not
authenticate a selected price leaf or its lifecycle. Prefer the full `Proof` API.
