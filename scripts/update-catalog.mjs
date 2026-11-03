// Explicit maintenance command. Catalog metadata never supplies verification trust.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

assert.equal(process.argv.length, 2, 'This command takes no arguments');
const source = 'https://docs.supra.com/oracles/data-feeds/data-feeds-index';
const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
assert(response.ok, `Catalog HTTP ${response.status}`);
const html = await response.text();
assert(html.length < 5_000_000, 'Unexpected catalog size');
const plain = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
const statuses = new Map([
  ['supra premium', 'premium'],
  ['supra standard', 'standard'],
  ['under supervision', 'under-supervision'],
  ['deprecated', 'deprecated'],
  ['deprecate', 'deprecated'],
  ['coming soon', 'coming-soon'],
]);
const listings = new Map();
for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
    (cell) => plain(cell[1]),
  );
  if (cells.length !== 3 || !/^\d+$/.test(cells[1])) continue;
  const [name, idText, category] = cells;
  const id = Number(idText);
  const status = statuses.get(
    category.toLowerCase().replace(/ \(primary exchange rate\)$/, ''),
  );
  assert(Number.isInteger(id) && id >= 0 && id <= 0xffffffff);
  assert(status, `Unknown catalog status: ${category}`);
  const entry = {
    id,
    symbol: name.replace(/\s*\(.*$/, '').trim(),
    name,
    status,
  };
  const group = listings.get(id) ?? [];
  if (
    !group.some(
      (existing) =>
        existing.symbol === entry.symbol && existing.status === entry.status,
    )
  )
    group.push(entry);
  listings.set(id, group);
}
assert(listings.size > 100, 'Catalog tables missing or unexpectedly truncated');
const groups = [...listings.values()].sort((a, b) => a[0].id - b[0].id);
const pairs = groups
  .filter((group) => group.length === 1)
  .map(([entry]) => entry);
const conflicts = groups
  .filter((group) => group.length > 1)
  .map((group) => ({ id: group[0].id, listings: group }));
const destination = new URL('../catalog/pairs.json', import.meta.url);
mkdirSync(new URL('../catalog/', import.meta.url), { recursive: true });
writeFileSync(
  destination,
  JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      source,
      sourceSha256: createHash('sha256').update(html).digest('hex'),
      pairs,
      conflicts,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Wrote ${pairs.length} unambiguous entries and ${conflicts.length} conflicts; no proofs or trust were fetched.`,
);
