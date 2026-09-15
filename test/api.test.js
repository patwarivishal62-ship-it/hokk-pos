'use strict';
/* API integration tests — run with `npm test`. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Use an isolated throw-away database for tests.
process.env.HOKK_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-pos-')), 'db.json');

const { createApp } = require('../server');

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
const put = (p, body) => fetch(base + p, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('serves the frontend', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /HOKK POS/);
});

test('seeds the product catalog', async () => {
  const { status, body } = await get('/api/products');
  assert.equal(status, 200);
  assert.ok(body.length >= 20, 'expected seeded catalog');
  assert.ok(body.every((p) => Number.isFinite(p.price) && Number.isInteger(p.stock)));
});

test('filters products by category and search', async () => {
  const { body: coffee } = await get('/api/products?category=Coffee');
  assert.ok(coffee.length >= 4);
  assert.ok(coffee.every((p) => p.category === 'Coffee'));

  const { body: found } = await get('/api/products?search=espresso');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Espresso');
});

test('creates and updates a product', async () => {
  const created = await post('/api/products', {
    name: 'Test Cookie', category: 'Bakery', price: 2.5, cost: 0.8, stock: 12, emoji: '🍪',
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.id);
  assert.match(created.body.sku, /^HOKK-\d{3}$/);

  const updated = await put(`/api/products/${created.body.id}`, { price: 3.0, stock: 9 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.price, 3.0);
  assert.equal(updated.body.stock, 9);
});

test('rejects invalid products', async () => {
  const res = await post('/api/products', { price: 5 });
  assert.equal(res.status, 400);
  const res2 = await post('/api/products', { name: 'X', price: -2, stock: 1 });
  assert.equal(res2.status, 400);
});

test('completes a cash sale, decrements stock, computes totals', async () => {
  const p01 = (await get('/api/products')).body.find((p) => p.id === 'p01');
  const stockBefore = p01.stock;

  const res = await post('/api/sales', {
    items: [
      { productId: 'p01', qty: 2 }, // Espresso 3.00
      { productId: 'p16', qty: 1 }, // Croissant 3.75
    ],
    discountPct: 10,
    paymentMethod: 'cash',
    cashTendered: 20,
  });
  assert.equal(res.status, 201);
  const sale = res.body;
  assert.equal(sale.subtotal, 9.75);
  assert.equal(sale.discountAmount, 0.98);
  assert.equal(sale.taxAmount, 0.75); // (9.75 - 0.98) * 0.085 = 0.74545 -> 0.75
  assert.equal(sale.total, 9.52);
  assert.equal(sale.changeDue, 10.48);
  assert.equal(sale.status, 'completed');

  const after = (await get('/api/products')).body.find((p) => p.id === 'p01');
  assert.equal(after.stock, stockBefore - 2);
});

test('rejects a sale with insufficient stock', async () => {
  const res = await post('/api/sales', {
    items: [{ productId: 'p22', qty: 99999 }],
    paymentMethod: 'cash',
    cashTendered: 999999,
  });
  assert.equal(res.status, 409);
});

test('rejects cash below total and empty carts', async () => {
  const low = await post('/api/sales', {
    items: [{ productId: 'p01', qty: 1 }], paymentMethod: 'cash', cashTendered: 0.5,
  });
  assert.equal(low.status, 400);
  const empty = await post('/api/sales', { items: [], paymentMethod: 'card' });
  assert.equal(empty.status, 400);
});

test('processes card sales without tendered cash', async () => {
  const res = await post('/api/sales', {
    items: [{ productId: 'p02', qty: 1 }],
    paymentMethod: 'card',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.paymentMethod, 'card');
  assert.equal(res.body.changeDue, 0);
});

test('lists sales newest-first', async () => {
  const { status, body } = await get('/api/sales');
  assert.equal(status, 200);
  assert.ok(body.length >= 2);
  const times = body.map((s) => s.createdAt);
  assert.deepEqual([...times].sort().reverse(), times);
});

test('refund restocks items and flags the sale', async () => {
  const saleRes = await post('/api/sales', {
    items: [{ productId: 'p10', qty: 2 }],
    paymentMethod: 'card',
  });
  const stockMid = (await get('/api/products')).body.find((p) => p.id === 'p10').stock;

  const refund = await post(`/api/sales/${saleRes.body.id}/refund`, {});
  assert.equal(refund.status, 200);
  assert.equal(refund.body.status, 'refunded');

  const stockAfter = (await get('/api/products')).body.find((p) => p.id === 'p10').stock;
  assert.equal(stockAfter, stockMid + 2);

  const twice = await post(`/api/sales/${saleRes.body.id}/refund`, {});
  assert.equal(twice.status, 409);
});

test('stats endpoint reports today and inventory health', async () => {
  const { status, body } = await get('/api/stats');
  assert.equal(status, 200);
  assert.ok(body.today.revenue > 0, 'refunded sales excluded but completed ones remain');
  assert.ok(body.today.transactions >= 2);
  assert.equal(body.last7Days.length, 7);
  assert.ok(body.inventory.totalProducts >= 20);
  assert.ok(Array.isArray(body.lowStock));
});
