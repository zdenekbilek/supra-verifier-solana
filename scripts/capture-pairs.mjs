// Explicit, bounded public-proof capture and read-only EVM cross-check.
// No wallets, environment files, signatures generated here, or trust discovery.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  compactProof,
  encodeProof,
  PROOF_ENDPOINT,
  SUPRA_TRUST,
  SUPRA_COMMITTEE_0_TRUST,
  verifySupraProof,
} from '../tools/proof.ts';

const pairs = process.argv.slice(2).map((arg) => {
  assert(/^(0|[1-9]\d*)$/.test(arg), 'Pass one to eight numeric pair IDs');
  const id = Number(arg);
  assert(Number.isSafeInteger(id) && id <= 0xffffffff, 'Pair ID must fit u32');
  return id;
});
assert(
  pairs.length > 0 && pairs.length <= 8 && new Set(pairs).size === pairs.length,
);
const rpcUrl = 'https://arb1.arbitrum.io/rpc';
const verifier = '0x41AB2059bAA4b73E9A3f55D30Dff27179e0eA181';
const rpc = async (method, params) => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `Reference RPC HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.error, JSON.stringify(body.error));
  return body.result;
};
assert.equal(await rpc('eth_chainId', []), '0xa4b1');
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const selector = Buffer.from(
  keccak_256(new TextEncoder().encode('verifyOracleProofV2(bytes)')),
)
  .subarray(0, 4)
  .toString('hex');
const catalog = JSON.parse(
  readFileSync(new URL('../catalog/pairs.json', import.meta.url)),
);
const configuredTrusts = [SUPRA_COMMITTEE_0_TRUST, SUPRA_TRUST];
const vectors = [];
const failures = [];
for (const pair of pairs) {
  try {
    const response = await fetch(PROOF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_indexes: [pair], chain_type: 'evm' }),
      signal: AbortSignal.timeout(10_000),
    });
    assert(response.ok, `Proof HTTP ${response.status}`);
    const responseText = await response.text();
    const capturedAt = new Date().toISOString();
    const body = JSON.parse(responseText);
    assert.deepEqual(body.pair_indexes, [pair]);
    const compact = compactProof(body.proof_bytes, pair);
    const trust = configuredTrusts.find(
      (trust) => trust.committeeId === compact.readBigUInt64LE(0),
    );
    assert(trust, 'Committee not in the independently captured trust set');
    const quote = verifySupraProof(compact, pair, trust);
    const proof = body.proof_bytes.replace(/^0x/, '');
    const data =
      '0x' +
      selector +
      word(32) +
      word(proof.length / 2) +
      proof.padEnd(Math.ceil(proof.length / 64) * 64, '0');
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    const result = await rpc('eth_call', [
      { to: verifier, data },
      block.number,
    ]);
    const bytes = Buffer.from(result.slice(2), 'hex');
    const uint = (offset) => {
      assert(
        Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset % 32 === 0 &&
          offset + 32 <= bytes.length,
      );
      return BigInt('0x' + bytes.subarray(offset, offset + 32).toString('hex'));
    };
    const offset = (at) => {
      const value = uint(at);
      assert(value <= BigInt(bytes.length));
      return Number(value);
    };
    const tuple = offset(0);
    const fields = Array.from({ length: 5 }, (_, index) => {
      const start = tuple + offset(tuple + index * 32);
      assert.equal(uint(start), 1n, 'Expected exactly one reference result');
      return uint(start + 32).toString();
    });
    assert.deepEqual(fields, [
      String(pair),
      quote.price,
      String(quote.publish_time_ms),
      String(quote.decimals),
      quote.oracle_round,
    ]);
    const input = encodeProof(compact, pair, trust.domain);
    vectors.push({
      pair,
      symbol: catalog.pairs.find((entry) => entry.id === pair)?.symbol ?? null,
      capturedAt,
      responseText,
      proofHex: body.proof_bytes,
      compactHex: compact.toString('hex'),
      witnessHex: input.subarray(compact.length).toString('hex'),
      quote,
      reference: { blockNumber: block.number, blockHash: block.hash, result },
    });
    console.log(
      `Authenticated pair ${pair}; EVM result matches all signed fields.`,
    );
  } catch (error) {
    failures.push({ pair, error: error.message });
    console.log(`Pair ${pair}: ${error.message}`);
  }
}
const destination = new URL('../target/captured-pairs.json', import.meta.url);
mkdirSync(new URL('../target/', import.meta.url), { recursive: true });
writeFileSync(
  destination,
  JSON.stringify(
    {
      source: PROOF_ENDPOINT,
      reference: {
        rpcUrl,
        chainId: 42161,
        verifier,
        function: 'verifyOracleProofV2(bytes)',
      },
      vectors,
      failures,
    },
    null,
    2,
  ) + '\n',
);
assert(vectors.length, 'No authenticated vectors captured');
console.log(
  `Saved ${vectors.length} verified vectors and ${failures.length} failures under target/. Review before promoting fixtures.`,
);
