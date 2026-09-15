#!/usr/bin/env node
/**
 * HOKK POS — backend server.
 * Zero runtime dependencies: built entirely on Node's standard library.
 *
 *  - Serves the static frontend from ./public
 *  - REST API under /api (products, sales, refunds, stats)
 *  - JSON-file persistence in ./data/db.json (auto-seeded on first run)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.HOKK_DB || path.join(DATA_DIR, 'db.json');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

function seedDb() {
  const P = (id, name, category, price, cost, stock, emoji, sku) => ({
    id, name, category, price, cost, stock, emoji, sku, lowStockThreshold: 10,
  });
  return {
    settings: {
      storeName: 'HOKK Store & Café',
      currency: 'USD',
      taxRate: 8.5,
    },
    counters: { sale: 1000 },
    products: [
      P('p01', 'Espresso',            'Coffee',  3.00, 0.45, 220, '☕', 'HOKK-001'),
      P('p02', 'Cappuccino',          'Coffee',  4.25, 0.80, 180, '☕', 'HOKK-002'),
      P('p03', 'Caffè Latte',         'Coffee',  4.50, 0.85, 175, '🥛', 'HOKK-003'),
      P('p04', 'Flat White',          'Coffee',  4.25, 0.80, 140, '☕', 'HOKK-004'),
      P('p05', 'Cold Brew',           'Coffee',  4.75, 0.95,  90, '🧊', 'HOKK-005'),
      P('p06', 'Matcha Latte',        'Tea',     4.95, 1.10,  80, '🍵', 'HOKK-006'),
      P('p07', 'Chai Latte',          'Tea',     4.50, 0.90,  85, '🫖', 'HOKK-007'),
      P('p08', 'Earl Grey Pot',       'Tea',     3.50, 0.60, 110, '🫖', 'HOKK-008'),
      P('p09', 'Fresh Orange Juice',  'Cold Drinks', 4.25, 1.20, 60, '🍊', 'HOKK-009'),
      P('p10', 'Sparkling Water',     'Cold Drinks', 2.75, 0.70, 95, '🫧', 'HOKK-010'),
      P('p11', 'Iced Lemonade',       'Cold Drinks', 3.95, 0.85, 70, '🍋', 'HOKK-011'),
      P('p12', 'Avocado Toast',       'Food',    8.95, 3.10, 40, '🥑', 'HOKK-012'),
      P('p13', 'Turkey Club Sandwich','Food',    9.50, 3.40, 35, '🥪', 'HOKK-013'),
      P('p14', 'Caesar Salad',        'Food',    8.50, 2.90, 30, '🥗', 'HOKK-014'),
      P('p15', 'Tomato Basil Soup',   'Food',    6.25, 1.80, 45, '🍲', 'HOKK-015'),
      P('p16', 'Butter Croissant',    'Bakery',  3.75, 1.00, 65, '🥐', 'HOKK-016'),
      P('p17', 'Blueberry Muffin',    'Bakery',  3.50, 0.95, 55, '🫐', 'HOKK-017'),
      P('p18', 'Cinnamon Roll',       'Bakery',  4.25, 1.20, 48, '🥮', 'HOKK-018'),
      P('p19', 'Chocolate Brownie',   'Bakery',  3.95, 1.10, 52, '🍫', 'HOKK-019'),
      P('p20', 'HOKK Travel Mug',     'Retail', 18.00, 7.50, 25, '🏺', 'HOKK-020'),
      P('p21', 'House Blend Beans 250g', 'Retail', 14.50, 6.20, 34, '🫘', 'HOKK-021'),
      P('p22', 'HOKK Tote Bag',       'Retail', 12.00, 4.80,  8, '🛍️', 'HOKK-022'),
      P('p23', 'Gift Card $25',       'Retail', 25.00, 0.00, 999, '🎁', 'HOKK-023'),
    ],
    sales: [],
  };
}

/* ------------------------------------------------------------------ */
/* JSON store                                                          */
/* ------------------------------------------------------------------ */

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      this.data = seedDb();
      this.save();
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

/* ------------------------------------------------------------------ */
/* Business logic                                                      */
/* ------------------------------------------------------------------ */

function computeTotals(items, discountPct, taxRate) {
  const subtotal = round2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const discountAmount = round2(subtotal * (Math.min(Math.max(discountPct, 0), 100) / 100));
  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2(taxable * (taxRate / 100));
  const total = round2(taxable + taxAmount);
  return { subtotal, discountPct, discountAmount, taxRate, taxAmount, total };
}

function listProducts(db, { search = '', category = '' } = {}) {
  let out = db.products;
  if (category && category !== 'All') out = out.filter((p) => p.category === category);
  if (search) {
    const q = search.toLowerCase();
    out = out.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q),
    );
  }
  return out;
}

function createSale(store, body) {
  const db = store.data;
  const itemsIn = Array.isArray(body.items) ? body.items : [];
  if (itemsIn.length === 0) throw httpError(400, 'Cart is empty');

  const items = [];
  for (const raw of itemsIn) {
    const product = db.products.find((p) => p.id === raw.productId);
    if (!product) throw httpError(404, `Product not found: ${raw.productId}`);
    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty <= 0) throw httpError(400, `Invalid quantity for ${product.name}`);
    if (product.stock < qty) throw httpError(409, `Insufficient stock for "${product.name}" (${product.stock} left)`);
    items.push({
      productId: product.id,
      name: product.name,
      emoji: product.emoji,
      price: product.price,
      qty,
      lineTotal: round2(product.price * qty),
    });
  }

  const paymentMethod = body.paymentMethod === 'card' ? 'card' : 'cash';
  const totals = computeTotals(items, Number(body.discountPct) || 0, db.settings.taxRate);

  let cashTendered = null;
  let changeDue = 0;
  if (paymentMethod === 'cash') {
    cashTendered = round2(Number(body.cashTendered));
    if (!Number.isFinite(cashTendered) || cashTendered < totals.total) {
      throw httpError(400, 'Cash tendered is less than the total due');
    }
    changeDue = round2(cashTendered - totals.total);
  }

  for (const it of items) {
    const product = db.products.find((p) => p.id === it.productId);
    product.stock -= it.qty;
  }

  db.counters.sale += 1;
  const sale = {
    id: `S-${db.counters.sale}`,
    items,
    ...totals,
    paymentMethod,
    cashTendered,
    changeDue,
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
  db.sales.push(sale);
  store.save();
  return sale;
}

function refundSale(store, id) {
  const db = store.data;
  const sale = db.sales.find((s) => s.id === id);
  if (!sale) throw httpError(404, 'Sale not found');
  if (sale.status === 'refunded') throw httpError(409, 'Sale already refunded');
  for (const it of sale.items) {
    const product = db.products.find((p) => p.id === it.productId);
    if (product) product.stock += it.qty;
  }
  sale.status = 'refunded';
  store.save();
  return sale;
}

function buildStats(db) {
  const today = dayKey();
  const completed = db.sales.filter((s) => s.status === 'completed');
  const todaySales = completed.filter((s) => dayKey(new Date(s.createdAt)) === today);

  const revenue = round2(todaySales.reduce((s, x) => s + x.total, 0));
  const itemsSold = todaySales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0);

  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    const dayRevenue = round2(
      completed
        .filter((s) => dayKey(new Date(s.createdAt)) === key)
        .reduce((s, x) => s + x.total, 0),
    );
    last7Days.push({
      date: key,
      label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      revenue: dayRevenue,
    });
  }

  const cutoff30 = Date.now() - 30 * 864e5;
  const productAgg = new Map();
  const categoryAgg = new Map();
  const cutoff7 = Date.now() - 7 * 864e5;
  for (const sale of completed) {
    const ts = new Date(sale.createdAt).getTime();
    if (ts >= cutoff30) {
      for (const it of sale.items) {
        const agg = productAgg.get(it.productId) || {
          name: it.name, emoji: it.emoji, qty: 0, revenue: 0,
        };
        agg.qty += it.qty;
        agg.revenue = round2(agg.revenue + it.lineTotal);
        productAgg.set(it.productId, agg);
      }
    }
    if (ts >= cutoff7) {
      for (const it of sale.items) {
        const product = db.products.find((p) => p.id === it.productId);
        const cat = product ? product.category : 'Other';
        categoryAgg.set(cat, round2((categoryAgg.get(cat) || 0) + it.lineTotal));
      }
    }
  }

  const topProducts = [...productAgg.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const categoryTotal = [...categoryAgg.values()].reduce((s, v) => s + v, 0) || 1;
  const categoryBreakdown = [...categoryAgg.entries()]
    .map(([category, rev]) => ({ category, revenue: rev, pct: Math.round((rev / categoryTotal) * 100) }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    settings: db.settings,
    today: {
      revenue,
      transactions: todaySales.length,
      itemsSold,
      avgOrder: todaySales.length ? round2(revenue / todaySales.length) : 0,
    },
    last7Days,
    topProducts,
    categoryBreakdown,
    lowStock: db.products
      .filter((p) => p.stock <= p.lowStockThreshold)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8)
      .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, stock: p.stock, lowStockThreshold: p.lowStockThreshold })),
    inventory: {
      totalProducts: db.products.length,
      outOfStock: db.products.filter((p) => p.stock === 0).length,
      lowStock: db.products.filter((p) => p.stock > 0 && p.stock <= p.lowStockThreshold).length,
      stockValue: round2(db.products.reduce((s, p) => s + p.cost * p.stock, 0)),
      retailValue: round2(db.products.reduce((s, p) => s + p.price * p.stock, 0)),
    },
  };
}

function validateProductBody(body, partial = false) {
  const out = {};
  const need = (k) => !(partial && body[k] === undefined);
  if (need('name')) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw httpError(400, 'name is required');
    out.name = body.name.trim();
  }
  if (need('price')) {
    const v = Number(body.price);
    if (!Number.isFinite(v) || v < 0) throw httpError(400, 'price must be a non-negative number');
    out.price = round2(v);
  }
  if (body.cost !== undefined) {
    const v = Number(body.cost);
    if (!Number.isFinite(v) || v < 0) throw httpError(400, 'cost must be a non-negative number');
    out.cost = round2(v);
  }
  if (need('stock')) {
    const v = Number(body.stock);
    if (!Number.isInteger(v) || v < 0) throw httpError(400, 'stock must be a non-negative integer');
    out.stock = v;
  }
  if (body.category !== undefined) out.category = String(body.category || 'Other').trim();
  if (body.emoji !== undefined) out.emoji = String(body.emoji || '🛒');
  if (body.sku !== undefined) out.sku = String(body.sku || '').trim();
  if (body.lowStockThreshold !== undefined) {
    const v = Number(body.lowStockThreshold);
    if (!Number.isInteger(v) || v < 0) throw httpError(400, 'lowStockThreshold must be a non-negative integer');
    out.lowStockThreshold = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function send(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }
  let stat = null;
  try { stat = fs.statSync(filePath); } catch { /* fallthrough */ }

  if (stat && stat.isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
}

async function handleApi(req, res, url, store) {
  const db = store.data;
  const p = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  /* Products ------------------------------------------------------- */
  if (p === '/api/products' && method === 'GET') {
    return send(res, 200, listProducts(db, {
      search: url.searchParams.get('search') || '',
      category: url.searchParams.get('category') || '',
    }));
  }
  if (p === '/api/products' && method === 'POST') {
    const body = await readBody(req);
    const fields = validateProductBody(body);
    const maxNum = db.products.reduce((m, x) => {
      const n = Number(String(x.sku || '').replace(/\D/g, ''));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const product = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      lowStockThreshold: 10,
      emoji: '🛒',
      sku: `HOKK-${String(maxNum + 1).padStart(3, '0')}`,
      ...fields,
    };
    db.products.push(product);
    store.save();
    return send(res, 201, product);
  }
  let m = p.match(/^\/api\/products\/([\w-]+)$/);
  if (m && method === 'GET') {
    const product = db.products.find((x) => x.id === m[1]);
    if (!product) throw httpError(404, 'Product not found');
    return send(res, 200, product);
  }
  if (m && method === 'PUT') {
    const product = db.products.find((x) => x.id === m[1]);
    if (!product) throw httpError(404, 'Product not found');
    const body = await readBody(req);
    Object.assign(product, validateProductBody(body, true));
    store.save();
    return send(res, 200, product);
  }
  if (m && method === 'DELETE') {
    const idx = db.products.findIndex((x) => x.id === m[1]);
    if (idx === -1) throw httpError(404, 'Product not found');
    db.products.splice(idx, 1);
    store.save();
    return send(res, 204, undefined);
  }

  /* Sales ----------------------------------------------------------- */
  if (p === '/api/sales' && method === 'POST') {
    const body = await readBody(req);
    return send(res, 201, createSale(store, body));
  }
  if (p === '/api/sales' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
    const out = [...db.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return send(res, 200, out);
  }
  m = p.match(/^\/api\/sales\/(S-\d+)\/refund$/);
  if (m && method === 'POST') {
    return send(res, 200, refundSale(store, m[1]));
  }
  m = p.match(/^\/api\/sales\/(S-\d+)$/);
  if (m && method === 'GET') {
    const sale = db.sales.find((s) => s.id === m[1]);
    if (!sale) throw httpError(404, 'Sale not found');
    return send(res, 200, sale);
  }

  /* Stats ----------------------------------------------------------- */
  if (p === '/api/stats' && method === 'GET') {
    return send(res, 200, buildStats(db));
  }

  throw httpError(404, 'Not found');
}

function createApp() {
  const store = new Store(DB_PATH);
  store.load();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, store);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url.pathname);
      } else {
        send(res, 405, { error: 'Method not allowed' });
      }
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: err.message || 'Internal error' });
    }
  });
}

module.exports = { createApp, computeTotals, Store, seedDb, DB_PATH };

if (require.main === module) {
  const server = createApp();
  server.listen(PORT, HOST, () => {
    console.log(`HOKK POS running at http://${HOST}:${PORT} (data: ${DB_PATH})`);
  });
}
