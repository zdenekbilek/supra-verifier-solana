// Owns an isolated offline chain. No --rpc option, env files, or real keypairs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import {
  compactProof,
  fetchProof,
  instructionData,
  buildWitnesses,
} from '../../tools/proof.ts';

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const live = process.argv.includes('--live');
if (process.argv.slice(2).some((arg) => arg !== '--live'))
  throw new Error('Only --live is supported');
const image =
  'surfpool/surfpool@sha256:4f7b64daa96ab42d8a0d46cd0de556b1c90386f56fd66cfdefcb5f7039fdec9f';
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: directory, ...options });
run(process.execPath, ['--import', 'tsx', '--test', 'tools/proof.test.mjs'], {
  stdio: 'inherit',
});
run('cargo', ['test', '--workspace', '--locked'], { stdio: 'inherit' });
run(
  'cargo-build-sbf',
  [
    '--manifest-path',
    'examples/verify-proof/Cargo.toml',
    '--sbf-out-dir',
    'target/deploy',
    '--tools-version',
    'v1.57',
    '--arch',
    'v0',
    '--',
    '--locked',
  ],
  { stdio: 'inherit' },
);

const abort = new AbortController();
const interrupt = () => abort.abort(new Error('Integration test interrupted'));
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const pause = (milliseconds) =>
  delay(milliseconds, undefined, { signal: abort.signal });
const temporary = mkdtempSync(path.join(tmpdir(), 'supra-verifier-'));
const container = `supra-verifier-${process.pid}`;
let started = false;
let resume;
const results = [];
try {
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-p',
    '127.0.0.1::8899',
    '-p',
    '127.0.0.1::8900',
    image,
    'start',
    '--offline',
    '--ci',
    '--no-deploy',
    '--airdrop-amount',
    '0',
    '--block-production-mode',
    'transaction',
  ]);
  started = true;
  const port = (value) =>
    run('docker', ['port', container, `${value}/tcp`], { encoding: 'utf8' })
      .trim()
      .split(':')
      .at(-1);
  const endpoint = `http://127.0.0.1:${port(8899)}`;
  const connection = new Connection(endpoint, {
    commitment: 'confirmed',
    wsEndpoint: `ws://127.0.0.1:${port(8900)}`,
  });
  const rpc = async (method, params = []) => {
    const signal =
      method === 'surfnet_resumeClock'
        ? AbortSignal.timeout(10000)
        : AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    });
    const result = await response.json();
    if (result.error)
      throw new Error(`Isolated Surfpool ${method}: ${result.error.message}`);
    return result.result;
  };
  for (let i = 0; ; i++) {
    try {
      await rpc('surfnet_getSurfnetInfo');
      break;
    } catch (error) {
      if (i === 60) throw error;
      await pause(250);
    }
  }
  const payer = Keypair.generate();
  const program = Keypair.generate();
  for (const [name, wallet] of [
    ['payer', payer],
    ['program', program],
  ])
    writeFileSync(
      path.join(temporary, `${name}.json`),
      JSON.stringify([...wallet.secretKey]),
      { mode: 0o600 },
    );
  await connection.requestAirdrop(payer.publicKey, 100_000_000_000);
  // Scratch-only loader setup. Binary execution and
  // subsequent upgrade happen in the SVM, with generated local authorities.
  const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const [programData] = PublicKey.findProgramAddressSync(
    [program.publicKey.toBuffer()],
    loader,
  );
  const binary = readFileSync(
    path.join(directory, 'target/deploy/supra_verify_example.so'),
  );
  const metadata = Buffer.alloc(45);
  metadata.writeUInt32LE(3);
  metadata[12] = 1;
  payer.publicKey.toBuffer().copy(metadata, 13);
  const executable = Buffer.alloc(36);
  executable.writeUInt32LE(2);
  programData.toBuffer().copy(executable, 4);
  for (const [address, bytes, isExecutable] of [
    [programData, Buffer.concat([metadata, binary]), false],
    [program.publicKey, executable, true],
  ])
    await rpc('surfnet_setAccount', [
      address.toBase58(),
      {
        owner: loader.toBase58(),
        lamports: await connection.getMinimumBalanceForRentExemption(
          bytes.length,
        ),
        executable: isExecutable,
        data: bytes.toString('hex'),
      },
    ]);
  run(
    'solana',
    [
      'program',
      'deploy',
      '--use-rpc',
      '--url',
      endpoint,
      '--keypair',
      path.join(temporary, 'payer.json'),
      '--program-id',
      program.publicKey.toBase58(),
      path.join(directory, 'target/deploy/supra_verify_example.so'),
    ],
    { stdio: 'inherit' },
  );

  await rpc('surfnet_pauseClock');
  resume = () => rpc('surfnet_resumeClock');
  let replayTime;
  const setTime = async (milliseconds) => {
    replayTime = milliseconds;
    // Replay the original signed fixture at its original time in THIS scratch
    // chain only. Never alter an oracle timestamp to make a fixture current.
    const previous = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    assert(previous, 'Clock sysvar missing');
    const data = Buffer.from(previous.data);
    data.writeBigInt64LE(BigInt(Math.floor(milliseconds / 1000)), 32);
    await rpc('surfnet_setAccount', [
      SYSVAR_CLOCK_PUBKEY.toBase58(),
      {
        owner: previous.owner.toBase58(),
        lamports: previous.lamports,
        executable: false,
        data: data.toString('hex'),
      },
    ]);
    const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    assert(
      clock &&
        Math.abs(Number(clock.data.readBigInt64LE(32)) * 1000 - milliseconds) <
          1000,
      'Fixture clock must match',
    );
  };
  const execute = async (
    name,
    proof,
    expectedSecond,
    previous = 0n,
    expectedError = null,
    options = {},
  ) => {
    abort.signal.throwIfAborted();
    // Transaction-mode blocks reconstruct sysvars after execution. Restore the
    // selected fixture time before EVERY test, including rejected transactions.
    assert(replayTime !== undefined, 'Select a scratch-chain clock first');
    await setTime(replayTime);
    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      new TransactionInstruction({
        programId: program.publicKey,
        keys: options.keys ?? [],
        data: instructionData(
          proof,
          options.expectedPair ?? 18,
          options.expectedCommittee ?? 1n,
          expectedSecond,
          previous,
          options.witnesses,
        ),
      }),
    );
    transaction.feePayer = payer.publicKey;
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    transaction.sign(payer);
    const bytes = transaction.serialize();
    assert(
      bytes.length <= 1232,
      'Single-transaction proof must fit network packet limit',
    );
    const simulated = await connection.simulateTransaction(transaction);
    if (expectedError !== null) {
      assert.deepEqual(
        simulated.value.err,
        { InstructionError: [1, { Custom: expectedError }] },
        `${name}: ${JSON.stringify(simulated.value)}`,
      );
    } else {
      assert.equal(simulated.value.err, null, JSON.stringify(simulated.value));
      assert(
        simulated.value.returnData,
        'Verifier must return authenticated quote',
      );
      assert.equal(
        simulated.value.returnData.programId,
        program.publicKey.toBase58(),
      );
      assert.equal(
        Buffer.from(simulated.value.returnData.data[0], 'base64').toString(
          'hex',
        ),
        proof.subarray(8, 46).toString('hex'),
      );
    }
    // Send rejected cases too, so rejection is tested in actual transactions.
    const signature = await connection.sendRawTransaction(bytes, {
      skipPreflight: true,
    });
    let status;
    for (let i = 0; i < 100; i++) {
      status = (await connection.getSignatureStatuses([signature])).value[0];
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      )
        break;
      await pause(100);
    }
    assert(
      status && ['confirmed', 'finalized'].includes(status.confirmationStatus),
      'Transaction confirmation missing',
    );
    assert.deepEqual(status.err, simulated.value.err);
    const landed = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    assert(landed?.meta, 'Confirmed execution metadata missing');
    assert.deepEqual(landed.meta.err, simulated.value.err);
    if (expectedError === null) {
      assert(
        landed.meta.returnData,
        'Confirmed transaction must return the authenticated quote',
      );
      assert.equal(
        landed.meta.returnData.programId,
        program.publicKey.toBase58(),
      );
      assert.equal(
        Buffer.from(landed.meta.returnData.data[0], 'base64').toString('hex'),
        proof.subarray(8, 46).toString('hex'),
      );
    }
    const result = {
      name,
      passed: true,
      expectedError,
      expectedPair: options.expectedPair ?? 18,
      expectedCommittee: String(options.expectedCommittee ?? 1n),
      transactionBytes: bytes.length,
      computeUnits: landed.meta.computeUnitsConsumed,
      simulationComputeUnits: simulated.value.unitsConsumed,
      signature,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  };
  const fixture = JSON.parse(
    readFileSync(path.join(directory, 'fixtures/btc-usd.json')),
  );
  const compact = compactProof(fixture.proofHex, 18);
  const fixtureSecond = Math.floor(Number(compact.readBigUInt64LE(28)) / 1000);
  const vectors = JSON.parse(
    readFileSync(path.join(directory, 'fixtures/vectors.json')),
  ).vectors;
  for (const [index, vector] of vectors.entries()) {
    const proof = Buffer.from(vector.compactHex, 'hex');
    await setTime(vector.timestampMs + 4000);
    await execute(
      `signed mapping vector ${index + 1}`,
      proof,
      Math.floor(vector.timestampMs / 1000),
    );
  }
  const pairs = JSON.parse(
    readFileSync(path.join(directory, 'fixtures/pairs.json')),
  ).vectors;
  for (const vector of pairs) {
    const proof = Buffer.from(vector.compactHex, 'hex');
    const second = Math.floor(vector.quote.publish_time_ms / 1000);
    const options = {
      expectedPair: vector.pair,
      expectedCommittee: BigInt(vector.quote.committee_id),
    };
    await setTime((second + 4) * 1000);
    await execute(
      `original signed pair ${vector.pair} (${vector.symbol})`,
      proof,
      second,
      0n,
      null,
      options,
    );
    await execute(
      `valid pair ${vector.pair} cannot substitute another feed`,
      proof,
      second,
      0n,
      3,
      { ...options, expectedPair: vector.pair === 0 ? 1 : 0 },
    );
    const altered = Buffer.from(proof);
    const otherPair = vector.pair === 0 ? 1 : 0;
    altered.writeUInt32LE(otherPair, 8);
    await execute(
      `mutated signed pair ${vector.pair} fails inclusion`,
      altered,
      second,
      0n,
      8,
      { ...options, expectedPair: otherPair },
    );
    await execute(
      `pair ${vector.pair} cannot choose another committee`,
      proof,
      second,
      0n,
      2,
      {
        ...options,
        expectedCommittee: options.expectedCommittee === 0n ? 1n : 0n,
      },
    );
  }
  await setTime(fixtureSecond * 1000 + 4000);
  await execute('original signed BTC/USD proof', compact, fixtureSecond);
  for (const [name, offset, error] of [
    ['price', 12, 8],
    ['timestamp', 28, 8],
    ['decimals', 36, 8],
    ['round', 38, 8],
    ['root', 46, 8],
    ['signature', 78, 9],
    ['Merkle sibling', 143, 8],
  ]) {
    const altered = Buffer.from(compact);
    altered[offset] ^= name === 'decimals' ? 2 : 1;
    await execute(`altered ${name}`, altered, fixtureSecond, 0n, error);
  }
  const unknown = Buffer.from(compact);
  unknown.writeBigUInt64LE(2n);
  await execute('unknown committee', unknown, fixtureSecond, 0n, 2);
  const zero = Buffer.from(compact);
  zero.fill(0, 78, 142);
  await execute('identity signature', zero, fixtureSecond, 0n, 9);
  const invalid = Buffer.from(compact);
  invalid.fill(0, 78, 142);
  invalid[109] = 1;
  invalid[141] = 1;
  await execute('off-curve signature', invalid, fixtureSecond, 0n, 9);
  for (const [name, offset] of [
    ['decision', 0],
    ['selected branch', 1],
    ['decision root', 2],
    ['inverse', 34],
    ['canonical Y root', 66],
    ['rejected branch root', 98],
  ]) {
    const witnesses = buildWitnesses(compact.subarray(46, 78));
    witnesses[offset] ^= 1;
    await execute(`untrusted ${name} witness`, compact, fixtureSecond, 0n, 11, {
      witnesses,
    });
  }
  const forged = JSON.parse(
    readFileSync(path.join(directory, 'fixtures/forged-tree.json')),
  );
  await execute(
    'forged tree with consistent Merkle root and unrelated signature',
    Buffer.from(forged.compactHex, 'hex'),
    fixtureSecond,
    0n,
    9,
  );
  const otherPair = Buffer.from(compact);
  otherPair.writeUInt32LE(0, 8);
  await execute('BTC/USDT is not BTC/USD', otherPair, fixtureSecond, 0n, 3);
  const zeroPrice = Buffer.from(compact);
  zeroPrice.fill(0, 12, 28);
  await execute('zero price', zeroPrice, fixtureSecond, 0n, 4);
  const decimals = Buffer.from(compact);
  decimals.writeUInt16LE(19, 36);
  await execute(
    'unsupported decimal precision',
    decimals,
    fixtureSecond,
    0n,
    4,
  );
  await execute(
    'unexpected account supplied by caller',
    compact,
    fixtureSecond,
    0n,
    1,
    { keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }] },
  );
  const timestamp = compact.readBigUInt64LE(28);
  await setTime(Number(timestamp) + 8000);
  await execute(
    'authenticated observation in its exact second',
    compact,
    fixtureSecond,
  );
  await execute(
    'observation from the previous second',
    compact,
    fixtureSecond + 1,
    0n,
    5,
  );
  await execute(
    'observation from the following second',
    compact,
    fixtureSecond - 1,
    0n,
    5,
  );
  await execute(
    'reused observation against prior timestamp',
    compact,
    fixtureSecond,
    timestamp,
    7,
  );
  await execute(
    'truncated proof',
    compact.subarray(0, -1),
    fixtureSecond,
    0n,
    1,
  );
  await execute(
    'trailing bytes',
    Buffer.concat([compact, Buffer.from([0])]),
    fixtureSecond,
    0n,
    1,
  );
  await setTime(Number(timestamp / 1000n) * 1000 - 1000);
  await execute('future observation', compact, fixtureSecond, 0n, 6);
  await setTime(Number(timestamp) + 1_802_000);
  await execute('stale observation', compact, fixtureSecond, 0n, 12);

  if (live) {
    // Explicit opt-in, one bounded request; no API key or environment file is loaded.
    const selected = await fetchProof(18, abort.signal);
    const timestamp = Number(selected.compact.readBigUInt64LE(28));
    assert(
      timestamp <= Date.now() && Date.now() - timestamp <= 10_000,
      'Live observation must be no more than ten seconds old',
    );
    const expectedSecond = Math.floor(timestamp / 1000);
    await setTime(Math.ceil(timestamp / 1000) * 1000 + 1000);
    await execute(
      'fresh public Supra BTC/USD proof',
      selected.compact,
      expectedSecond,
    );
    writeFileSync(
      path.join(directory, 'target/live-proof.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          proofHex: selected.hex,
          expectedSecond,
        },
        null,
        2,
      ),
    );
  }
  const accepted = results.filter((result) => result.expectedError === null);
  const summary = {
    transactions: results.length,
    accepted: accepted.length,
    rejected: results.length - accepted.length,
    maxComputeUnits: Math.max(...accepted.map((result) => result.computeUnits)),
    maxAcceptedTransactionBytes: Math.max(
      ...accepted.map((result) => result.transactionBytes),
    ),
  };
  writeFileSync(
    path.join(directory, 'target/results.json'),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        mode: live ? 'fixture-and-live' : 'fixture-only',
        program: program.publicKey.toBase58(),
        binaryBytes: binary.length,
        summary,
        results,
      },
      null,
      2,
    ),
  );
  console.log('Supra integration passed:', JSON.stringify(summary));
} finally {
  if (resume) await resume().catch(() => {});
  try {
    if (started) run('docker', ['stop', container], { stdio: 'pipe' });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
