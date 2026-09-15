#!/usr/bin/env node
/**
 * Generates realistic demo sales over the past 7 days so the
 * Dashboard and Sales History have something to show.
 * Usage: npm run demo   (server may be stopped; writes to data/db.json)
 */
'use strict';

const { Store, computeTotals, DB_PATH } = require('../server');

const store = new Store(DB_PATH);
store.load();
const db = store.data;

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];

const created = [];
for (let day = 6; day >= 0; day -= 1) {
  const salesToday = day === 0 ? randInt(9, 14) : randInt(4, 12);
  for (let i = 0; i < salesToday; i += 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(randInt(8, 19), randInt(0, 59), randInt(0, 59), 0);

    const itemCount = randInt(1, 4);
    const items = [];
    const used = new Set();
    for (let k = 0; k < itemCount; k += 1) {
      let product = pick(db.products);
      while (used.has(product.id) || product.stock <= 0) product = pick(db.products);
      used.add(product.id);
      const qty = randInt(1, 3);
      if (product.stock < qty) continue;
      product.stock -= qty;
      items.push({
        productId: product.id,
        name: product.name,
        emoji: product.emoji,
        price: product.price,
        qty,
        lineTotal: Math.round(product.price * qty * 100) / 100,
      });
    }
    if (items.length === 0) continue;

    const discountPct = Math.random() < 0.15 ? pick([5, 10, 15]) : 0;
    const totals = computeTotals(items, discountPct, db.settings.taxRate);
    const paymentMethod = Math.random() < 0.55 ? 'card' : 'cash';
    const cashTendered = paymentMethod === 'cash'
      ? Math.ceil(totals.total / 5) * 5
      : null;

    db.counters.sale += 1;
    const sale = {
      id: `S-${db.counters.sale}`,
      items,
      ...totals,
      paymentMethod,
      cashTendered,
      changeDue: cashTendered ? Math.round((cashTendered - totals.total) * 100) / 100 : 0,
      status: 'completed',
      createdAt: d.toISOString(),
    };
    db.sales.push(sale);
    created.push(sale);
  }
}

store.save();
const revenue = created.reduce((s, x) => s + x.total, 0);
console.log(`✅ Generated ${created.length} demo sales ($${revenue.toFixed(2)} total) over the last 7 days.`);
