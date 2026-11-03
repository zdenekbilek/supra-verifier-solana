import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactProof, littleEndian, instructionData } from './proof.ts';
import { buildWitnesses } from './proof.ts';
import { encodeProof, verifySupraProof, SUPRA_TRUST } from './proof.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/btc-usd.json', import.meta.url)),
);

test('lossless packing matches the independently decoded, EVM-verified fixture', () => {
  const compact = compactProof(fixture.proofHex);
  assert.equal(compact.toString('hex'), fixture.compactHex);
  assert.equal(compact.readUInt32LE(8), 18);
  assert.equal(compact.readUInt16LE(36), 8);
  assert.equal(
    buildWitnesses(compact.subarray(46, 78)).toString('hex'),
    fixture.witnessHex,
  );
  assert.equal(
    instructionData(compact, fixture.boundaryMs).length,
    compact.length + 16 + 324,
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
      () => compactProof(changed.toString('hex')),
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
    assert.throws(() => compactProof(hex));
  const bytes = Buffer.from(fixture.proofHex.slice(2), 'hex');
  bytes.fill(255, 0, 32);
  assert.throws(() => compactProof(bytes.toString('hex')), /offset/);
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
    const quote = verifySupraProof(compact);
    assert.equal(quote.committee_id, '1');
    assert.equal(quote.publish_time_ms, vector.timestampMs);
    assert.equal(
      encodeProof(compact).toString('hex'),
      vector.compactHex + vector.witnessHex,
    );
  }
});

test('verification rejects forged roots, modified prices and untrusted keys/domains', () => {
  const compact = Buffer.from(fixture.compactHex, 'hex');
  const changed = Buffer.from(compact);
  changed[12] ^= 1;
  assert.throws(() => verifySupraProof(changed), /Merkle/);
  const forged = JSON.parse(
    readFileSync(new URL('../fixtures/forged-tree.json', import.meta.url)),
  );
  assert.throws(
    () => verifySupraProof(Buffer.from(forged.compactHex, 'hex')),
    /signature/,
  );
  assert.throws(
    () => verifySupraProof(compact, { ...SUPRA_TRUST, committeeId: 2n }),
    /trust/,
  );
  assert.throws(() =>
    verifySupraProof(compact, { ...SUPRA_TRUST, publicKey: Buffer.alloc(128) }),
  );
  assert.throws(
    () =>
      verifySupraProof(compact, { ...SUPRA_TRUST, domain: Buffer.alloc(32) }),
    /signature/,
  );
});
