import { SUPRA_DOMAIN_HEX, SUPRA_PUBLIC_KEY_HEX } from './trust.js';
import {
  buildWitnessesBytes,
  decodeSupraQuoteBytes,
  hashToSupraPoint,
  trustHashBytes,
  verifySupraProofBytes,
} from './crypto.js';
export { hashToSupraPoint };
export type { SupraQuote } from './crypto.js';

export const SUPRA_DOMAIN = Buffer.from(SUPRA_DOMAIN_HEX, 'hex');
export function buildWitnesses(
  root: Buffer,
  domain: Buffer = SUPRA_DOMAIN,
): Buffer {
  return Buffer.from(buildWitnessesBytes(root, domain));
}

// Only the one-committee, one-leaf BTC/USD proof shape is supported here.
// Packing removes ABI padding; every original signed field is retained.
export const PROOF_ENDPOINT = 'https://rpc-mainnet-dora-2.supra.com/get_proof';
const MAX_DEPTH = 16;

export function littleEndian(value: bigint | number | string, length: number) {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Unsafe integer');
  let remaining = BigInt(value);
  if (remaining < 0n) throw new Error('Negative unsigned integer');
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    out[i] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('Integer exceeds field width');
  return out;
}

export function compactProof(hex: string) {
  if (typeof hex !== 'string' || !/^(?:0x)?(?:[a-fA-F0-9]{2})+$/.test(hex))
    throw new Error('Invalid proof hex');
  const input = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const word = (at: number) => {
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at % 32 !== 0 ||
      at + 32 > input.length
    )
      throw new Error('Invalid ABI offset');
    return input.subarray(at, at + 32);
  };
  const uint = (at: number) => BigInt('0x' + word(at).toString('hex'));
  const offset = (base: number, at: number) => {
    const value = uint(at);
    if (value > BigInt(input.length))
      throw new Error('ABI offset out of bounds');
    return base + Number(value);
  };
  const tuple = offset(0, 0);
  const array = offset(tuple, tuple);
  if (uint(array) !== 1n) throw new Error('Expected one committee');
  const committee = offset(array + 32, array + 32);
  const details = offset(committee, committee + 128);
  const leaves = offset(details, details);
  if (uint(leaves) !== 1n) throw new Error('Expected one price leaf');
  const leaf = leaves + 32;
  const values = [
    uint(leaf),
    uint(leaf + 32),
    uint(leaf + 64),
    uint(leaf + 96),
    uint(leaf + 128),
  ];
  if (values[0] !== 18n) throw new Error('Expected BTC/USD pair 18');
  const quote = Buffer.concat(
    values.map((value, i) => littleEndian(value, [4, 16, 8, 2, 8][i])),
  );
  const path = offset(details, details + 32);
  const count = uint(path);
  if (count > BigInt(MAX_DEPTH)) throw new Error('Merkle proof too deep');
  const flags = offset(details, details + 64);
  if (uint(flags) !== count) throw new Error('Unsupported multi-leaf proof');
  const siblings = [];
  for (let i = 0; i < Number(count); i++) {
    if (uint(flags + 32 + i * 32) !== 0n)
      throw new Error('Unsupported multi-leaf flag');
    siblings.push(word(path + 32 + i * 32));
  }
  return Buffer.concat([
    littleEndian(uint(committee), 8),
    quote,
    word(committee + 32),
    word(committee + 64),
    word(committee + 96),
    Buffer.from([Number(count)]),
    ...siblings,
  ]);
}

/** Instruction envelope for the stateless example only; expectedSecond is in Unix seconds. */
export function instructionData(
  proof: Buffer,
  expectedSecond: bigint | number,
  previousMs = 0n,
  witnesses = buildWitnesses(proof.subarray(46, 78)),
) {
  if (witnesses.length !== 324) throw new Error('Expected 324 witness bytes');
  return Buffer.concat([
    littleEndian(expectedSecond, 8),
    littleEndian(previousMs, 8),
    proof,
    witnesses,
  ]);
}

export async function fetchProof(signal?: AbortSignal) {
  const response = await fetch(PROOF_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair_indexes: [18], chain_type: 'evm' }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Supra proof endpoint returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('pair_indexes' in body) ||
    !('proof_bytes' in body) ||
    typeof body.proof_bytes !== 'string'
  )
    throw new Error('Malformed Supra response');
  if (
    !Array.isArray(body.pair_indexes) ||
    body.pair_indexes.length !== 1 ||
    body.pair_indexes[0] !== 18
  )
    throw new Error('Unexpected proof pair');
  return { hex: body.proof_bytes, compact: compactProof(body.proof_bytes) };
}

export interface SupraTrust {
  committeeId: bigint;
  publicKey: Buffer;
  domain: Buffer;
}
export const SUPRA_PUBLIC_KEY = Buffer.from(SUPRA_PUBLIC_KEY_HEX, 'hex');
export const SUPRA_TRUST: SupraTrust = {
  committeeId: 1n,
  publicKey: SUPRA_PUBLIC_KEY,
  domain: SUPRA_DOMAIN,
};
/** Structural decoding only. Use verifySupraProof to authenticate a quote. */
export function decodeSupraQuote(compact: Buffer) {
  return decodeSupraQuoteBytes(compact);
}
export function trustHash(trust: SupraTrust): Buffer {
  return Buffer.from(trustHashBytes(trust));
}
export function verifySupraProof(
  compact: Buffer,
  trust: SupraTrust = SUPRA_TRUST,
) {
  return verifySupraProofBytes(compact, trust);
}

/** Append untrusted arithmetic witnesses; this does not authenticate the proof. */
export function encodeProof(
  compact: Buffer,
  domain: Buffer = SUPRA_DOMAIN,
): Buffer {
  decodeSupraQuote(compact);
  return Buffer.concat([
    compact,
    buildWitnesses(compact.subarray(46, 78), domain),
  ]);
}
