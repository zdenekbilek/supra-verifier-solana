# Stateless Solana verification example

Run `npm run test:integration` from the repository root. The launcher builds this
program, starts its own digest-pinned offline Surfpool with random loopback ports,
creates disposable payer/program keys and submits signed test transactions.
It checks both simulation and confirmed execution, including returned quote bytes,
compute consumption and the 1,232-byte packet limit.

Original fixture timestamps are preserved. Historical Clock replay is restricted
to this disposable harness. The command cannot target an external RPC, reads no
wallet or env file, and cleans up its container and temporary wallets.
The optional `--live` flag makes one bounded public proof request; it still
submits only to the isolated scratch chain and never learns trust from the API.

The 28-byte instruction prefix is expected pair `u32`, expected committee `u64`,
expected Unix second `u64` and previous observation Unix milliseconds `u64`, then
the unchanged Rust proof input. The example selects only the independently
captured committee-0 or committee-1 key; arbitrary keys are never instruction inputs. The return data
is the original authenticated 38-byte quote. See [encoding](../../docs/encoding.md).

This example checks exact-second timing, future observations, 30-minute freshness
and ordering, using the unchanged signed milliseconds. Its pair, committee and timing arguments are
caller supplied and it stores no state. A real application must derive those
arguments from its own authenticated accounts, enforce one-time transitions and
deadlines, bind trust/governance and check CPI return-data provenance. See
[integration responsibilities](../../docs/integration.md).
