/** Portable Supra verification and arithmetic witness generation.
 * FT mapping follows the attributed implementation in ../NOTICE.
 * No Node APIs, wallet access, network requests or server assertions are trusted.
 */
import { bn254 } from '@noble/curves/bn254';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { SUPRA_DOMAIN_HEX, SUPRA_PUBLIC_KEY_HEX } from './trust.js';

const P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const Z0 = 4407920970296243842837207485651524041948558517760411303933n;
const Z1 = 2203960485148121921418603742825762020974279258880205651966n;
const mod = (value: bigint) => ((value % P) + P) % P;
const field = (value: bigint) =>
  hexToBytes(mod(value).toString(16).padStart(64, '0'));
const integer = (value: Uint8Array) => BigInt('0x' + bytesToHex(value));
const hash = (...parts: Uint8Array[]) => sha256(concatBytes(...parts));
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const compare = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
function pow(value: bigint, exponent: bigint) {
  let out = 1n,
    x = mod(value),
    n = exponent;
  while (n > 0n) {
    if (n & 1n) out = mod(out * x);
    x = mod(x * x);
    n >>= 1n;
  }
  return out;
}
function sqrt(value: bigint) {
  const root = pow(value, (P + 1n) / 4n);
  return { root, exists: mod(root * root) === mod(value) };
}
function mapWitness(input: bigint) {
  const decision = sqrt(input);
  const decisionRoot = decision.exists ? decision.root : sqrt(-input).root;
  const a0 = mod(input * input + 4n),
    a1 = mod(input * Z0);
  const inverse = pow(a1 * a0, P - 2n);
  const x1 = mod(Z1 - input * a1 * a1 * inverse);
  const rejected = [0n, 0n];
  for (const [branch, x] of [
    x1,
    mod(-x1 - 1n),
    mod(a0 ** 4n * inverse * inverse + 1n),
  ].entries()) {
    const curve = mod(x ** 3n + 3n),
      y = sqrt(curve);
    if (!y.exists) {
      rejected[branch] = sqrt(-curve).root;
      continue;
    }
    const canonicalRoot = sqrt(y.root);
    if (!canonicalRoot.exists) throw new Error('Noncanonical square root');
    return {
      x,
      y: decision.exists ? y.root : mod(-y.root),
      witness: concatBytes(
        Uint8Array.of(Number(decision.exists), branch),
        field(decisionRoot),
        field(inverse),
        field(canonicalRoot.root),
        ...rejected.map(field),
      ),
    };
  }
  throw new Error('FT map failed');
}
function maps(root: Uint8Array, domain: Uint8Array) {
  if (root.length !== 32 || domain.length !== 32)
    throw new Error('Root and domain must be 32 bytes');
  const b0 = hash(
    new Uint8Array(64),
    root,
    Uint8Array.of(0, 96, 0),
    domain,
    Uint8Array.of(32),
  );
  let previous = hash(b0, Uint8Array.of(1), domain, Uint8Array.of(32));
  const blocks = [previous];
  for (let i = 2; i <= 3; i++) {
    previous = hash(
      b0.map((byte, j) => byte ^ previous[j]),
      Uint8Array.of(i),
      domain,
      Uint8Array.of(32),
    );
    blocks.push(previous);
  }
  const expanded = concatBytes(...blocks);
  return [
    mapWitness(integer(expanded.subarray(0, 48)) % P),
    mapWitness(integer(expanded.subarray(48)) % P),
  ];
}

export interface SupraTrustBytes {
  committeeId: bigint;
  publicKey: Uint8Array;
  domain: Uint8Array;
}
export const CANONICAL_SUPRA_TRUST: SupraTrustBytes = {
  committeeId: 1n,
  publicKey: hexToBytes(SUPRA_PUBLIC_KEY_HEX),
  domain: hexToBytes(SUPRA_DOMAIN_HEX),
};
export interface SupraQuote {
  pair_id: number;
  decimals: number;
  price: string;
  expo: number;
  publish_time: number;
  publish_time_ms: number;
  oracle_round: string;
  committee_id: string;
}
export const buildWitnessesBytes = (
  root: Uint8Array,
  domain = CANONICAL_SUPRA_TRUST.domain,
) => concatBytes(...maps(root, domain).map((point) => point.witness));
export function hashToSupraPoint(
  root: Uint8Array,
  domain = CANONICAL_SUPRA_TRUST.domain,
) {
  const points = maps(root, domain);
  return bn254.G1.Point.fromAffine({ x: points[0].x, y: points[0].y }).add(
    bn254.G1.Point.fromAffine({ x: points[1].x, y: points[1].y }),
  );
}
export function trustHashBytes(trust: SupraTrustBytes) {
  if (
    trust.committeeId < 0n ||
    trust.committeeId > 0xffffffffffffffffn ||
    trust.publicKey.length !== 128 ||
    trust.domain.length !== 32
  )
    throw new Error('Unknown oracle trust');
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, trust.committeeId, true);
  return hash(id, trust.publicKey, trust.domain);
}
/** Validate an explicitly selected on-wire u32 feed ID, including JS callers. */
export function assertPairId(pair: number): void {
  if (!Number.isInteger(pair) || pair < 0 || pair > 0xffffffff)
    throw new Error('Expected an unsigned 32-bit pair ID');
}
export function decodeSupraQuoteBytes(compact: Uint8Array): SupraQuote {
  if (
    compact.length < 143 ||
    compact[142] > 16 ||
    compact.length !== 143 + compact[142] * 32
  )
    throw new Error('Invalid compact proof');
  const view = new DataView(
    compact.buffer,
    compact.byteOffset,
    compact.byteLength,
  );
  const price =
    view.getBigUint64(12, true) + (view.getBigUint64(20, true) << 64n);
  const milliseconds = view.getBigUint64(28, true),
    decimals = view.getUint16(36, true);
  if (
    price === 0n ||
    decimals > 18 ||
    milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Unsupported quote fields');
  return {
    pair_id: view.getUint32(8, true),
    decimals,
    price: price.toString(),
    expo: -decimals,
    publish_time: Math.floor(Number(milliseconds) / 1000),
    publish_time_ms: Number(milliseconds),
    oracle_round: view.getBigUint64(38, true).toString(),
    committee_id: view.getBigUint64(0, true).toString(),
  };
}
export function verifySupraProofBytes(
  compact: Uint8Array,
  expectedPair: number,
  trust: SupraTrustBytes = CANONICAL_SUPRA_TRUST,
): SupraQuote {
  assertPairId(expectedPair);
  trustHashBytes(trust); // Validate trust widths even when no hash label is needed.
  const quote = decodeSupraQuoteBytes(compact);
  if (quote.pair_id !== expectedPair) throw new Error('Unexpected proof pair');
  if (BigInt(quote.committee_id) !== trust.committeeId)
    throw new Error('Unknown oracle trust');
  let root = keccak_256(compact.subarray(8, 46));
  for (let offset = 143; offset < compact.length; offset += 32) {
    const sibling = compact.subarray(offset, offset + 32);
    root = keccak_256(
      compare(root, sibling) < 0
        ? concatBytes(root, sibling)
        : concatBytes(sibling, root),
    );
  }
  if (!equal(root, compact.subarray(46, 78)))
    throw new Error('Invalid Merkle proof');
  const sig = bn254.G1.Point.fromAffine({
    x: integer(compact.subarray(78, 110)),
    y: integer(compact.subarray(110, 142)),
  });
  sig.assertValidity();
  if (sig.equals(bn254.G1.Point.ZERO))
    throw new Error('Identity oracle signature');
  const key = bn254.G2.Point.fromAffine({
    x: {
      c0: integer(trust.publicKey.subarray(32, 64)),
      c1: integer(trust.publicKey.subarray(0, 32)),
    },
    y: {
      c0: integer(trust.publicKey.subarray(96, 128)),
      c1: integer(trust.publicKey.subarray(64, 96)),
    },
  });
  key.assertValidity();
  if (key.equals(bn254.G2.Point.ZERO)) throw new Error('Identity oracle key');
  const result = bn254.pairingBatch([
    { g1: sig.negate(), g2: bn254.G2.Point.BASE },
    { g1: hashToSupraPoint(root, trust.domain), g2: key },
  ]);
  if (!bn254.fields.Fp12.eql(result, bn254.fields.Fp12.ONE))
    throw new Error('Invalid oracle signature');
  return quote;
}
