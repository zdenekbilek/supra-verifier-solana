# Integration responsibilities

`Proof::decode` checks byte structure only. `Proof::verify(expected_pair)` checks
the selected pair and quote fields, Merkle inclusion and the BLS signature under
the historical default trust.
`verify_with(expected_pair, committee, key, domain)` uses trust that your application must authenticate independently.
Neither verification function reads Clock or application state. `VerifiedQuote` means the
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

The bundled keys/domain came from a historical Arbitrum verifier snapshot, not
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
upgrade policy or API availability guarantee. The default accepts only historical
committee 1; other committees require explicit independently authenticated
configuration. The example also allows the bundled historical committee 0 key.
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

## Existing consumers

The wire format, committee/domain constants, trust hash and numeric error codes
are compatible with the original verifier. The public Rust API deliberately
requires a migration: `Proof` fields are private, `verify` / `verify_with` require
an explicit expected pair and return `VerifiedQuote` rather than `()`. There are no unauthenticated quote
accessors on `Proof`.

Keep an existing Rust import name with Cargo's dependency renaming:

```toml
[dependencies]
supra-verifier = { package = "supra-verifier-solana", version = "0.1.0" }
# For local development, add path = "../supra-verifier-solana" to the entry above.
```

Authenticate using the application's independently configured trust, then read
the quote. This function also illustrates converting a `u128` price for a
consumer with signed 64-bit storage without truncating it:

```rust
use supra_verifier::{Error, Proof};

fn authenticated_price(
    bytes: &[u8],
    expected_pair: u32,
    committee: u64,
    key: &[u8; 128],
    domain: &[u8; 32],
) -> Result<(i64, i32, u64), Error> {
    let quote = Proof::decode(bytes)?.verify_with(expected_pair, committee, key, domain)?;
    let price = i64::try_from(quote.price()).map_err(|_| Error::Price)?;
    Ok((price, -i32::from(quote.decimals()), quote.timestamp_ms()))
}
```

Every caller must supply the expected numeric pair from authenticated application
configuration. Never derive that expectation from the untrusted proof or a catalog
lookup with conflicting results. Existing BTC/USD consumers must explicitly pass
`BTC_USD_PAIR` (18); another valid pair cannot substitute for it.

Replace any former `validate_quote_for` call with full verification. Match
`Error::Pair`, `Error::Price`, `Error::Committee` and `Error::Encoding` explicitly
if your application distinguishes these failures; map cryptographic failures
to its signature/proof error. Perform time, ordering and lifecycle checks on the
authenticated quote, using the application's existing authenticated state.
Reject expired obligations before expensive verification when their deadline
does not depend on proof fields. Embedding the library requires no account, application instruction, signed-byte
or trust changes. The standalone example has a new 28-byte envelope described in
[encoding.md](encoding.md). It does change failure precedence when several
checks would fail at once.

Quote-dependent timing rejections also need the full verification compute budget,
because signature verification now runs first. Include that budget in negative
timing tests as well as successful submissions.

`crypto` exposes lower-level primitives for review and reuse. Merkle verification
alone does not authenticate a root; root-signature verification alone does not
authenticate a selected price leaf or its lifecycle. Prefer the full `Proof` API.
