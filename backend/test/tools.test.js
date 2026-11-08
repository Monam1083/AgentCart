import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts, compareOptions, priceLines, proposeCart, TOOL_DECLARATIONS } from '../src/tools.js';
import { createStore } from '../src/store.js';

function ctxWithLimit(limitCents) {
  const store = createStore();
  const session = store.getSession('session-test-1', { spendingLimitCents: limitCents });
  return { store, session, lastCart: null };
}

test('search excludes out-of-stock items', () => {
  const r = searchProducts({ query: 'shrimp' });
  assert.equal(r.count, 0);
});

test('search honours exclude_tags and max_price', () => {
  const r = searchProducts({ category: 'bundle', exclude_tags: ['pork'], max_price: 14 });
  assert.ok(r.count > 0);
  for (const p of r.results) {
    assert.ok(!p.tags.includes('pork'));
    assert.ok(p.priceCents <= 1400);
  }
});

test('search honours require_tags', () => {
  const r = searchProducts({ require_tags: ['vegan'] });
  assert.ok(r.count > 0);
  for (const p of r.results) assert.ok(p.tags.includes('vegan'));
});

test('compare ranks by price per serving and rejects unknown ids', () => {
  const r = compareOptions({ item_ids: ['f01', 'f12'] });
  assert.equal(r.bestValueId, 'f12'); // fries: $4.99 / 8 servings
  assert.ok(compareOptions({ item_ids: ['f01', 'nope'] }).error);
  assert.ok(compareOptions({ item_ids: ['f01'] }).error);
});

test('priceLines computes totals and shipping in integer cents', () => {
  const small = priceLines([{ id: 'f12', quantity: 1 }]);
  assert.equal(small.itemTotalCents, 499);
  assert.equal(small.shippingCents, 399);
  assert.equal(small.totalCents, 898);

  const big = priceLines([{ id: 'b03', quantity: 3 }]); // 68.97 => free shipping
  assert.equal(big.itemTotalCents, 6897);
  assert.equal(big.shippingCents, 0);
});

test('priceLines merges duplicate lines and rejects bad input', () => {
  const merged = priceLines([{ id: 'f12', quantity: 1 }, { id: 'f12', quantity: 2 }]);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].quantity, 3);
  assert.ok(priceLines([]).error);
  assert.ok(priceLines([{ id: 'zzz', quantity: 1 }]).error);
  assert.ok(priceLines([{ id: 'f12', quantity: 0 }]).error);
  assert.ok(priceLines([{ id: 'f12', quantity: 99 }]).error);
  assert.ok(priceLines([{ id: 'f10', quantity: 1 }]).error); // out of stock
});

test('propose_cart saves a draft priced by the server and enforces the spending limit', () => {
  const ok = ctxWithLimit(5000);
  const res = proposeCart({ items: [{ id: 'b01', quantity: 1 }] }, ok);
  assert.equal(res.status, 'proposed');
  assert.equal(ok.lastCart.status, 'proposed');
  assert.equal(ok.lastCart.totalCents, 1249 + 399);

  const tight = ctxWithLimit(1000);
  const blocked = proposeCart({ items: [{ id: 'b01', quantity: 1 }] }, tight);
  assert.match(blocked.error, /spending limit/);
  assert.equal(tight.lastCart, null);
});

test('the agent has no payment capability', () => {
  const names = TOOL_DECLARATIONS.map((t) => t.name);
  assert.deepEqual(names.sort(), ['compare_options', 'propose_cart', 'search_products']);
  for (const n of names) assert.doesNotMatch(n, /pay|capture|confirm|order|checkout/i);
});
