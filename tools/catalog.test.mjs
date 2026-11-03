import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('catalog IDs are unique and conflicting source listings cannot resolve silently', () => {
  const catalog = JSON.parse(
    readFileSync(new URL('../catalog/pairs.json', import.meta.url)),
  );
  assert.equal(catalog.schemaVersion, 1);
  assert.match(catalog.sourceSha256, /^[a-f0-9]{64}$/);
  const ids = new Set();
  const statuses = [
    'premium',
    'standard',
    'under-supervision',
    'deprecated',
    'coming-soon',
  ];
  for (const entry of catalog.pairs) {
    assert(
      Number.isInteger(entry.id) && entry.id >= 0 && entry.id <= 0xffffffff,
    );
    assert(!ids.has(entry.id));
    ids.add(entry.id);
    assert(entry.symbol && entry.name && statuses.includes(entry.status));
  }
  for (const conflict of catalog.conflicts) {
    assert(!ids.has(conflict.id));
    ids.add(conflict.id);
    assert(conflict.listings.length > 1);
    assert(conflict.listings.every((listing) => listing.id === conflict.id));
  }
  assert.equal(catalog.pairs.find((pair) => pair.id === 18).symbol, 'BTC_USD');
  assert.equal(catalog.pairs.find((pair) => pair.id === 0).symbol, 'BTC_USDT');
});
