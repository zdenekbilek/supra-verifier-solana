import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactProof, littleEndian, instructionData } from './proof.ts';
import { buildWitnesses } from './proof.ts';
import {
  encodeProof,
  verifySupraProof,
  SUPRA_TRUST,
  SUPRA_COMMITTEE_0_TRUST,
  fetchProof,
  decodeSupraQuote,
} from './proof.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/btc-usd.json', import.meta.url)),
);

test('lossless packing matches the independently decoded, EVM-verified fixture', () => {
  const compact = compactProof(fixture.proofHex, 18);
  assert.equal(compact.toString('hex'), fixture.compactHex);
  assert.equal(compact.readUInt32LE(8), 18);
  assert.equal(compact.readUInt16LE(36), 8);
  assert.equal(
    buildWitnesses(compact.subarray(46, 78)).toString('hex'),
    fixture.witnessHex,
  );
  assert.equal(
    instructionData(
      compact,
      18,
      1n,
      Math.floor(Number(compact.readBigUInt64LE(28)) / 1000),
    ).length,
    compact.length + 28 + 324,
  );
});

test('rejects multi-committee, multi-leaf, oversized and wrongly typed ABI fields', () => {
  const original = Buffer.from(fixture.proofHex.slice(2), 'hex');
  const integer = (at) =>
    Number(BigInt('0x' + original.subarray(at, at + 32).toString('hex')));
  const tuple = integer(0);
  const array = tuple + integer(tuple);
  const committee = array + 32 + integer(array + 32);
  const details = committee + integer(committee + 128);
  const leaves = details + integer(details);
  const path = details + integer(details + 32);
  const flags = details + integer(details + 64);
  for (const [offset, value] of [
    [array, 2n],
    [leaves, 2n],
    [path, 17n],
    [flags, 0n],
    [flags + 32, 1n],
    [leaves + 32, 0n],
    [leaves + 64, 1n << 128n],
    [leaves + 96, 1n << 64n],
    [leaves + 128, 1n << 16n],
    [leaves + 160, 1n << 64n],
    [committee, 1n << 64n],
    [tuple, 1n],
  ]) {
    const changed = Buffer.from(original);
    Buffer.from(value.toString(16).padStart(64, '0'), 'hex').copy(
      changed,
      offset,
    );
    assert.throws(
      () => compactProof(changed.toString('hex'), 18),
      `ABI word ${offset}`,
    );
  }
});

test('witness builder matches every captured mapping branch', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../fixtures/vectors.json', import.meta.url)),
  );
  const cases = new Set();
  for (const vector of vectors.vectors) {
    const compact = Buffer.from(vector.compactHex, 'hex');
    const hints = buildWitnesses(compact.subarray(46, 78));
    assert.equal(hints.toString('hex'), vector.witnessHex);
    for (let point = 0; point < 2; point++)
      cases.add(`${point}:${hints[point * 162]}:${hints[point * 162 + 1]}`);
  }
  assert.deepEqual([...cases].sort(), vectors.cases);
  assert.throws(() => buildWitnesses(Buffer.alloc(31)));
});

test('rejects truncated proofs, unsafe offsets, wrong leaves and malformed hex', () => {
  for (const hex of ['', '0x', 'xyz', '0x1', fixture.proofHex.slice(0, 100)])
    assert.throws(() => compactProof(hex, 18));
  const bytes = Buffer.from(fixture.proofHex.slice(2), 'hex');
  bytes.fill(255, 0, 32);
  assert.throws(() => compactProof(bytes.toString('hex'), 18), /offset/);
  assert.throws(() => littleEndian(-1n, 8));
  assert.throws(() => littleEndian(1n << 128n, 16));
  assert.throws(() => littleEndian(Number.MAX_SAFE_INTEGER + 1, 8));
});

test('every original signed vector verifies independently off chain', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../fixtures/vectors.json', import.meta.url)),
  );
  for (const vector of vectors.vectors) {
    const compact = Buffer.from(vector.compactHex, 'hex');
    const quote = verifySupraProof(compact, 18);
    assert.equal(quote.committee_id, '1');
    assert.equal(quote.publish_time_ms, vector.timestampMs);
    assert.equal(
      encodeProof(compact, 18).toString('hex'),
      vector.compactHex + vector.witnessHex,
    );
  }
});

test('verification rejects forged roots, modified prices and untrusted keys/domains', () => {
  const compact = Buffer.from(fixture.compactHex, 'hex');
  const changed = Buffer.from(compact);
  changed[12] ^= 1;
  assert.throws(() => verifySupraProof(changed, 18), /Merkle/);
  const forged = JSON.parse(
    readFileSync(new URL('../fixtures/forged-tree.json', import.meta.url)),
  );
  assert.throws(
    () => verifySupraProof(Buffer.from(forged.compactHex, 'hex'), 18),
    /signature/,
  );
  assert.throws(
    () => verifySupraProof(compact, 18, { ...SUPRA_TRUST, committeeId: 2n }),
    /trust/,
  );
  assert.throws(() =>
    verifySupraProof(compact, 18, {
      ...SUPRA_TRUST,
      publicKey: Buffer.alloc(128),
    }),
  );
  assert.throws(
    () =>
      verifySupraProof(compact, 18, {
        ...SUPRA_TRUST,
        domain: Buffer.alloc(32),
      }),
    /signature/,
  );
});

const pairs = JSON.parse(
  readFileSync(new URL('../fixtures/pairs.json', import.meta.url)),
);

test('original cross-asset proofs preserve all fields and cannot substitute another pair', () => {
  for (const vector of pairs.vectors) {
    const compact = compactProof(vector.proofHex, vector.pair);
    const trust =
      vector.quote.committee_id === '0' ? SUPRA_COMMITTEE_0_TRUST : SUPRA_TRUST;
    assert.equal(compact.toString('hex'), vector.compactHex);
    assert.deepEqual(
      JSON.parse(vector.responseText).proof_bytes,
      vector.proofHex,
    );
    assert.deepEqual(
      verifySupraProof(compact, vector.pair, trust),
      vector.quote,
    );
    assert.equal(
      encodeProof(compact, vector.pair, trust.domain).toString('hex'),
      vector.compactHex + vector.witnessHex,
    );
    const otherPair = vector.pair === 0 ? 1 : 0;
    assert.throws(() => verifySupraProof(compact, otherPair, trust), /pair/);
    assert.throws(() => compactProof(vector.proofHex, otherPair), /pair/);
    assert.throws(() => encodeProof(compact, otherPair), /pair/);
    const altered = Buffer.from(compact);
    altered.writeUInt32LE(otherPair, 8);
    assert.throws(() => verifySupraProof(altered, otherPair, trust), /Merkle/);
    if (trust.committeeId === 0n)
      assert.throws(() => verifySupraProof(compact, vector.pair), /trust/);
  }
  const wide = pairs.vectors.find(
    (vector) => BigInt(vector.quote.price) > 0xffffffffffffffffn,
  );
  assert(wide, 'Regression set must exercise unsigned prices wider than u64');
  assert(pairs.vectors.some((vector) => vector.quote.decimals === 18));
  assert(pairs.vectors.some((vector) => vector.quote.decimals === 8));
});

test('pair selection is mandatory, accepts u32 IDs, and decoding remains structural', () => {
  const compact = Buffer.from(fixture.compactHex, 'hex');
  for (const pair of [
    undefined,
    null,
    -1,
    1.5,
    NaN,
    Infinity,
    0x100000000,
    '18',
  ]) {
    assert.throws(() => verifySupraProof(compact, pair), /pair ID/);
    assert.throws(() => compactProof(fixture.proofHex, pair), /pair ID/);
    assert.throws(() => encodeProof(compact, pair), /pair ID/);
  }
  for (const pair of [0, 0xffffffff]) {
    const altered = Buffer.from(compact);
    altered.writeUInt32LE(pair, 8);
    assert.equal(decodeSupraQuote(altered).pair_id, pair);
    assert.throws(() => verifySupraProof(altered, pair), /Merkle/);
  }
});

test('fetch requests one explicit pair and rejects mismatched response and signed IDs', async (t) => {
  const vector = pairs.vectors.find((vector) => vector.pair === 0);
  const response = JSON.parse(vector.responseText);
  let returned = response;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(returned));
  });
  const fetched = await fetchProof(0);
  assert.equal(fetched.compact.toString('hex'), vector.compactHex);
  assert.deepEqual(requests[0].body, { pair_indexes: [0], chain_type: 'evm' });
  returned = { ...response, pair_indexes: [19] };
  await assert.rejects(fetchProof(0), /pair/);
  returned = { ...response, pair_indexes: [18] };
  await assert.rejects(fetchProof(18), /pair/);
  const count = requests.length;
  await assert.rejects(fetchProof(), /pair ID/);
  assert.equal(requests.length, count);
});
