/* ============================================================
   HOKK POS — frontend application
   ============================================================ */
'use strict';

/* ---------------- Helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`.trim();
  el.textContent = message;
  $('#toastHost').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; }, 2600);
  setTimeout(() => el.remove(), 3100);
}

/* ---------------- API client ---------------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------- State ---------------- */
const state = {
  view: 'register',
  products: [],
  categories: [],
  category: 'All',
  search: '',
  cart: new Map(), // productId -> qty
  discountPct: 0,
  settings: { storeName: 'HOKK Store & Café', taxRate: 8.5, currency: 'USD' },
  payMethod: 'cash',
  sales: [],
  stats: null,
  lastSale: null,
  expandedSale: null,
};

/* ---------------- Clock ---------------- */
function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
setInterval(tickClock, 15000);
tickClock();

/* ---------------- Navigation ---------------- */
$$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

async function switchView(view) {
  state.view = view;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  if (view === 'register') await loadProducts();
  if (view === 'dashboard') await loadDashboard();
  if (view === 'inventory') await loadInventory();
  if (view === 'sales') await loadSales();
}

/* ============================================================
   REGISTER
   ============================================================ */

async function loadProducts() {
  try {
    state.products = await api('/api/products');
    state.categories = ['All', ...new Set(state.products.map((p) => p.category))];
    renderChips();
    renderProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderChips() {
  $('#categoryChips').innerHTML = state.categories.map((c) => `
    <button class="chip ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
  `).join('');
}

$('#categoryChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.category = chip.dataset.cat;
  renderChips();
  renderProducts();
});

$('#productSearch').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  renderProducts();
});

function renderProducts() {
  const q = state.search.toLowerCase();
  const items = state.products.filter((p) => {
    const catOk = state.category === 'All' || p.category === state.category;
    const searchOk = !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
    return catOk && searchOk;
  });

  $('#productGrid').innerHTML = items.length ? items.map((p) => {
    const out = p.stock <= 0;
    const low = !out && p.stock <= p.lowStockThreshold;
    return `
      <button class="product-card" data-id="${p.id}" ${out ? 'disabled' : ''}>
        <span class="stock-badge ${out ? 'out' : low ? 'low' : ''}">${out ? 'Out' : `${p.stock} left`}</span>
        <span class="product-emoji">${p.emoji || '🛒'}</span>
        <span class="product-name">${esc(p.name)}</span>
        <span class="product-price money">${money(p.price)}</span>
      </button>`;
  }).join('') : '<div class="cart-empty">No products match your search.</div>';
}

$('#productGrid').addEventListener('click', (e) => {
  const card = e.target.closest('.product-card');
  if (!card || card.disabled) return;
  addToCart(card.dataset.id);
});

/* ---------------- Cart ---------------- */

function addToCart(productId, qty = 1) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const current = state.cart.get(productId) || 0;
  if (current + qty > product.stock) {
    toast(`Only ${product.stock} × "${product.name}" in stock`, 'warn');
    return;
  }
  state.cart.set(productId, current + qty);
  renderCart();
}

function setQty(productId, qty) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  if (qty <= 0) { state.cart.delete(productId); }
  else if (qty > product.stock) { toast(`Only ${product.stock} in stock`, 'warn'); state.cart.set(productId, product.stock); }
  else state.cart.set(productId, qty);
  renderCart();
}

function cartLines() {
  return [...state.cart.entries()].map(([id, qty]) => {
    const p = state.products.find((x) => x.id === id);
    return p ? { product: p, qty, lineTotal: round2(p.price * qty) } : null;
  }).filter(Boolean);
}

function cartTotals() {
  const lines = cartLines();
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discountPct = Math.min(Math.max(state.discountPct, 0), 100);
  const discountAmount = round2(subtotal * (discountPct / 100));
  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2(taxable * (state.settings.taxRate / 100));
  return { lines, subtotal, discountAmount, taxAmount, total: round2(taxable + taxAmount), discountPct };
}

function renderCart() {
  const lines = cartLines();
  const host = $('#cartItems');
  host.innerHTML = lines.length ? lines.map(({ product, qty, lineTotal }) => `
    <div class="cart-line">
      <div>
        <div class="cart-line-name">${product.emoji || ''} ${esc(product.name)}</div>
        <div class="cart-line-price money">${money(product.price)} each</div>
      </div>
      <div class="cart-line-total money">${money(lineTotal)}</div>
      <div class="qty-controls">
        <button class="qty-btn" data-act="dec" data-id="${product.id}">−</button>
        <span class="qty-val">${qty}</span>
        <button class="qty-btn" data-act="inc" data-id="${product.id}">＋</button>
        <button class="cart-line-remove" data-act="rm" data-id="${product.id}" title="Remove">🗑</button>
      </div>
    </div>
  `).join('') : '<div class="cart-empty">Cart is empty.<br/>Tap products to add them.</div>';

  const t = cartTotals();
  $('#taxRateLabel').textContent = state.settings.taxRate;
  $('#sumSubtotal').textContent = money(t.subtotal);
  $('#sumDiscount').textContent = `−${money(t.discountAmount)}`;
  $('#sumTax').textContent = money(t.taxAmount);
  $('#sumTotal').textContent = money(t.total);
  const chargeBtn = $('#chargeBtn');
  chargeBtn.disabled = t.lines.length === 0;
  chargeBtn.textContent = `Charge ${money(t.total)}`;
}

$('#cartItems').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const qty = state.cart.get(id) || 0;
  if (act === 'inc') setQty(id, qty + 1);
  if (act === 'dec') setQty(id, qty - 1);
  if (act === 'rm') setQty(id, 0);
});

$('#clearCartBtn').addEventListener('click', () => {
  state.cart.clear();
  state.discountPct = 0;
  $('#discountInput').value = 0;
  renderCart();
});

$('#discountInput').addEventListener('input', (e) => {
  state.discountPct = Math.min(Math.max(Number(e.target.value) || 0, 0), 100);
  renderCart();
});

/* ---------------- Payment modal ---------------- */

function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

$$('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
$$('.modal-backdrop').forEach((bd) => bd.addEventListener('click', (e) => {
  if (e.target === bd && bd.id !== 'receiptModal') bd.classList.add('hidden');
}));

$('#chargeBtn').addEventListener('click', () => {
  const t = cartTotals();
  if (!t.lines.length) return;
  $('#payDueAmount').textContent = money(t.total);
  state.payMethod = 'cash';
  updatePayMethodUI();
  $('#cashTendered').value = '';
  $('#changeDue').textContent = money(0);
  renderQuickCash(t.total);
  validatePayment();
  openModal('paymentModal');
});

function updatePayMethodUI() {
  $('#payMethodCash').classList.toggle('active', state.payMethod === 'cash');
  $('#payMethodCard').classList.toggle('active', state.payMethod === 'card');
  $('#cashSection').classList.toggle('hidden', state.payMethod !== 'cash');
  $('#cardSection').classList.toggle('hidden', state.payMethod !== 'card');
}

$('#payMethodCash').addEventListener('click', () => { state.payMethod = 'cash'; updatePayMethodUI(); validatePayment(); });
$('#payMethodCard').addEventListener('click', () => { state.payMethod = 'card'; updatePayMethodUI(); validatePayment(); });

function renderQuickCash(total) {
  const candidates = [total];
  [5, 10, 20, 50, 100].forEach((n) => {
    const v = Math.ceil(total / n) * n;
    if (!candidates.includes(v)) candidates.push(v);
  });
  $('#quickCash').innerHTML = candidates.slice(0, 4)
    .map((v) => `<button type="button" data-amt="${round2(v)}">${money(v)}</button>`).join('');
}

$('#quickCash').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-amt]');
  if (!btn) return;
  $('#cashTendered').value = btn.dataset.amt;
  validatePayment();
});

function validatePayment() {
  const t = cartTotals();
  const btn = $('#confirmPaymentBtn');
  if (state.payMethod === 'card') {
    btn.disabled = t.lines.length === 0;
    $('#changeDue').textContent = money(0);
    return;
  }
  const tendered = Number($('#cashTendered').value);
  const ok = Number.isFinite(tendered) && tendered >= t.total;
  $('#changeDue').textContent = ok ? money(round2(tendered - t.total)) : money(0);
  btn.disabled = !ok;
}

$('#cashTendered').addEventListener('input', validatePayment);

$('#confirmPaymentBtn').addEventListener('click', async () => {
  const t = cartTotals();
  const btn = $('#confirmPaymentBtn');
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const sale = await api('/api/sales', {
      method: 'POST',
      body: {
        items: t.lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        discountPct: t.discountPct,
        paymentMethod: state.payMethod,
        cashTendered: state.payMethod === 'cash' ? round2(Number($('#cashTendered').value)) : undefined,
      },
    });
    state.lastSale = sale;
    closeModal('paymentModal');
    state.cart.clear();
    state.discountPct = 0;
    $('#discountInput').value = 0;
    await loadProducts();
    renderCart();
    showReceipt(sale);
    toast(`Sale ${sale.id} completed — ${money(sale.total)}`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.textContent = 'Complete Sale';
  }
});

/* ---------------- Receipt ---------------- */

function receiptHTML(sale) {
  const d = new Date(sale.createdAt);
  return `
    <div class="r-center">
      <div class="r-big">HOKK</div>
      <div>${esc(state.settings.storeName)}</div>
      <div>Receipt ${sale.id}</div>
      <div>${d.toLocaleString()}</div>
    </div>
    <div class="r-rule"></div>
    <table>
      ${sale.items.map((it) => `
        <tr>
          <td>${it.qty} × ${esc(it.name)}</td>
          <td class="amt">${money(it.lineTotal)}</td>
        </tr>`).join('')}
    </table>
    <div class="r-rule"></div>
    <table>
      <tr><td>Subtotal</td><td class="amt">${money(sale.subtotal)}</td></tr>
      ${sale.discountAmount > 0 ? `<tr><td>Discount (${sale.discountPct}%)</td><td class="amt">-${money(sale.discountAmount)}</td></tr>` : ''}
      <tr><td>Tax (${sale.taxRate}%)</td><td class="amt">${money(sale.taxAmount)}</td></tr>
      <tr class="r-total"><td>TOTAL</td><td class="amt">${money(sale.total)}</td></tr>
      <tr><td>Paid (${sale.paymentMethod})</td><td class="amt">${money(sale.paymentMethod === 'cash' ? sale.cashTendered : sale.total)}</td></tr>
      ${sale.paymentMethod === 'cash' ? `<tr><td>Change</td><td class="amt">${money(sale.changeDue)}</td></tr>` : ''}
    </table>
    <div class="r-rule"></div>
    <div class="r-center r-thanks">Thank you for shopping at HOKK!<br/>☆ ☆ ☆</div>
  `;
}

function showReceipt(sale) {
  $('#receiptPaper').innerHTML = receiptHTML(sale);
  openModal('receiptModal');
}

$('#newSaleBtn').addEventListener('click', () => closeModal('receiptModal'));
$('#printReceiptBtn').addEventListener('click', () => window.print());

/* ============================================================
   DASHBOARD
   ============================================================ */

async function loadDashboard() {
  try {
    const stats = await api('/api/stats');
    state.stats = stats;
    state.settings = stats.settings;
    renderDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderDashboard() {
  const s = state.stats;
  if (!s) return;
  $('#storeName').textContent = s.settings.storeName;
  $('#dashDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  $('#statRevenue').textContent = money(s.today.revenue);
  $('#statTx').textContent = s.today.transactions;
  $('#statAov').textContent = money(s.today.avgOrder);
  $('#statItems').textContent = s.today.itemsSold;
  $('#statRevenueSub').textContent = `${s.today.transactions} orders today`;
  $('#statTxSub').textContent = `${money(s.today.avgOrder)} average`;

  /* Revenue bar chart */
  const max = Math.max(...s.last7Days.map((d) => d.revenue), 1);
  $('#revenueChart').innerHTML = s.last7Days.map((d, i) => `
    <div class="bar-col ${i === s.last7Days.length - 1 ? 'today' : ''}" title="${d.date}: ${money(d.revenue)}">
      <div class="bar-amt">${d.revenue > 0 ? money(d.revenue) : ''}</div>
      <div class="bar" style="height:${Math.max((d.revenue / max) * 130, 3)}px"></div>
      <div class="bar-day">${d.label}</div>
    </div>
  `).join('');

  /* Top products */
  $('#topProducts').innerHTML = s.topProducts.length ? s.topProducts.map((p, i) => `
    <div class="list-row">
      <span class="badge-num">${i + 1}</span>
      <span>${p.emoji || ''}</span>
      <span class="grow">${esc(p.name)}</span>
      <span class="muted">${p.qty} sold</span>
      <span class="money" style="width:74px;text-align:right">${money(p.revenue)}</span>
    </div>
  `).join('') : '<div class="cart-empty">No sales yet.</div>';

  /* Category breakdown */
  $('#categoryBreakdown').innerHTML = s.categoryBreakdown.length ? s.categoryBreakdown.map((c) => `
    <div class="bar-row">
      <span class="bar-label">${esc(c.category)}</span>
      <div class="progress"><div style="width:${c.pct}%"></div></div>
      <span class="bar-value">${money(c.revenue)}</span>
    </div>
  `).join('') : '<div class="cart-empty">No sales yet.</div>';

  /* Inventory health */
  const inv = s.inventory;
  $('#inventoryHealth').innerHTML = `
    <div class="list-row"><span class="grow">Products</span><b>${inv.totalProducts}</b></div>
    <div class="list-row"><span class="grow">Low stock</span><span class="pill amber">${inv.lowStock}</span></div>
    <div class="list-row"><span class="grow">Out of stock</span><span class="pill red">${inv.outOfStock}</span></div>
    <div class="list-row"><span class="grow">Stock value (cost)</span><b class="money">${money(inv.stockValue)}</b></div>
    <div class="list-row"><span class="grow">Retail value</span><b class="money">${money(inv.retailValue)}</b></div>
  `;
  $('#lowStockList').innerHTML = s.lowStock.length ? s.lowStock.map((p) => `
    <div class="list-row">
      <span>${p.emoji || ''}</span>
      <span class="grow">${esc(p.name)}</span>
      <span class="pill ${p.stock === 0 ? 'red' : 'amber'}">${p.stock === 0 ? 'OUT' : `${p.stock} left`}</span>
    </div>
  `).join('') : '<div class="cart-empty">All stocked up ✨</div>';
}

/* ============================================================
   INVENTORY
   ============================================================ */

let inventoryCategoryFilter = 'All';

async function loadInventory() {
  try {
    state.products = await api('/api/products');
    renderInventory();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderInventory() {
  const cats = ['All', ...new Set(state.products.map((p) => p.category))];
  const catFilter = $('#invCategoryFilter');
  catFilter.innerHTML = cats.map((c) => `<option ${c === inventoryCategoryFilter ? 'selected' : ''}>${esc(c)}</option>`).join('');

  const q = $('#invSearch').value.trim().toLowerCase();
  const rows = state.products.filter((p) => {
    const catOk = inventoryCategoryFilter === 'All' || p.category === inventoryCategoryFilter;
    const searchOk = !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
    return catOk && searchOk;
  });

  $('#inventoryBody').innerHTML = rows.length ? rows.map((p) => {
    const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
    const status = p.stock === 0
      ? '<span class="pill red">Out of stock</span>'
      : p.stock <= p.lowStockThreshold
        ? '<span class="pill amber">Low stock</span>'
        : '<span class="pill green">In stock</span>';
    return `
      <tr>
        <td><div class="cell-product"><span class="emoji">${p.emoji || '🛒'}</span>${esc(p.name)}</div></td>
        <td class="muted">${esc(p.sku || '—')}</td>
        <td>${esc(p.category)}</td>
        <td class="num money">${money(p.price)}</td>
        <td class="num money muted">${money(p.cost)}</td>
        <td class="num">${margin}%</td>
        <td class="num">
          <div class="qty-controls" style="justify-content:flex-end">
            <button class="qty-btn" data-act="dec" data-id="${p.id}">−</button>
            <span class="qty-val">${p.stock}</span>
            <button class="qty-btn" data-act="inc" data-id="${p.id}">＋</button>
          </div>
        </td>
        <td>${status}</td>
        <td class="num">
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-act="del" data-id="${p.id}">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('') : '<tr><td colspan="9" class="empty">No products found.</td></tr>';
}

$('#invSearch').addEventListener('input', renderInventory);
$('#invCategoryFilter').addEventListener('change', (e) => {
  inventoryCategoryFilter = e.target.value;
  renderInventory();
});

$('#inventoryBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  if (act === 'inc' || act === 'dec') {
    const next = product.stock + (act === 'inc' ? 1 : -1);
    if (next < 0) return;
    try {
      await api(`/api/products/${id}`, { method: 'PUT', body: { stock: next } });
      await loadInventory();
    } catch (err) { toast(err.message, 'error'); }
  }

  if (act === 'edit') openProductForm(product);

  if (act === 'del') {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      toast(`Deleted ${product.name}`);
      await loadInventory();
    } catch (err) { toast(err.message, 'error'); }
  }
});

/* ---------------- Product form modal ---------------- */

$('#addProductBtn').addEventListener('click', () => openProductForm(null));

function openProductForm(product) {
  $('#productModalTitle').textContent = product ? `Edit — ${product.name}` : 'Add product';
  $('#pfId').value = product ? product.id : '';
  $('#pfName').value = product ? product.name : '';
  $('#pfEmoji').value = product ? product.emoji : '';
  $('#pfCategory').value = product ? product.category : '';
  $('#pfSku').value = product ? (product.sku || '') : '';
  $('#pfPrice').value = product ? product.price : '';
  $('#pfCost').value = product ? product.cost : 0;
  $('#pfStock').value = product ? product.stock : 0;
  $('#pfThreshold').value = product ? product.lowStockThreshold : 10;
  $('#categoryList').innerHTML = [...new Set(state.products.map((p) => p.category))]
    .map((c) => `<option value="${esc(c)}">`).join('');
  openModal('productModal');
  $('#pfName').focus();
}

$('#productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#pfId').value;
  const body = {
    name: $('#pfName').value.trim(),
    emoji: $('#pfEmoji').value.trim() || '🛒',
    category: $('#pfCategory').value.trim() || 'Other',
    sku: $('#pfSku').value.trim(),
    price: Number($('#pfPrice').value),
    cost: Number($('#pfCost').value || 0),
    stock: Number($('#pfStock').value || 0),
    lowStockThreshold: Number($('#pfThreshold').value || 10),
  };
  try {
    if (id) {
      await api(`/api/products/${id}`, { method: 'PUT', body });
      toast(`Updated ${body.name}`);
    } else {
      await api('/api/products', { method: 'POST', body });
      toast(`Added ${body.name}`);
    }
    closeModal('productModal');
    await loadInventory();
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ============================================================
   SALES HISTORY
   ============================================================ */

async function loadSales() {
  try {
    state.sales = await api('/api/sales?limit=200');
    renderSales();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#refreshSalesBtn').addEventListener('click', loadSales);

function renderSales() {
  const sales = state.sales;
  const completed = sales.filter((s) => s.status === 'completed');
  const revenue = round2(completed.reduce((s, x) => s + x.total, 0));
  $('#salesSummary').textContent = `${sales.length} transactions · ${money(revenue)} revenue`;
  $('#salesEmpty').classList.toggle('hidden', sales.length > 0);

  $('#salesBody').innerHTML = sales.map((s) => {
    const itemCount = s.items.reduce((a, i) => a + i.qty, 0);
    const statusPill = s.status === 'completed'
      ? '<span class="pill green">Completed</span>'
      : '<span class="pill red">Refunded</span>';
    const expanded = state.expandedSale === s.id;
    return `
      <tr class="sale-row" data-id="${s.id}" style="cursor:pointer">
        <td><b>${s.id}</b></td>
        <td class="muted">${fmtTime(s.createdAt)}</td>
        <td class="num">${itemCount}</td>
        <td>${s.paymentMethod === 'cash' ? '💵' : '💳'} ${s.paymentMethod}</td>
        <td class="num money"><b>${money(s.total)}</b></td>
        <td>${statusPill}</td>
        <td class="num"><span class="muted">${expanded ? '▲' : '▼'}</span></td>
      </tr>
      ${expanded ? `
      <tr class="sale-detail-row">
        <td colspan="7">
          <div class="sale-detail">
            ${s.items.map((it) => `<div class="line"><span>${it.qty} × ${esc(it.name)}</span><span class="money">${money(it.lineTotal)}</span></div>`).join('')}
            <div class="line"><span>Subtotal</span><span class="money">${money(s.subtotal)}</span></div>
            ${s.discountAmount > 0 ? `<div class="line"><span>Discount (${s.discountPct}%)</span><span class="money">−${money(s.discountAmount)}</span></div>` : ''}
            <div class="line"><span>Tax (${s.taxRate}%)</span><span class="money">${money(s.taxAmount)}</span></div>
            <div class="line total"><span>Total</span><span class="money">${money(s.total)}</span></div>
            ${s.status === 'completed'
              ? `<div style="margin-top:8px"><button class="btn btn-danger btn-sm" data-refund="${s.id}">↩ Refund &amp; restock</button></div>`
              : ''}
          </div>
        </td>
      </tr>` : ''}
    `;
  }).join('');
}

$('#salesBody').addEventListener('click', async (e) => {
  const refundBtn = e.target.closest('[data-refund]');
  if (refundBtn) {
    e.stopPropagation();
    const id = refundBtn.dataset.refund;
    if (!confirm(`Refund sale ${id}? Items will be returned to stock.`)) return;
    try {
      await api(`/api/sales/${id}/refund`, { method: 'POST' });
      toast(`Sale ${id} refunded`);
      await loadSales();
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  const row = e.target.closest('.sale-row');
  if (!row) return;
  state.expandedSale = state.expandedSale === row.dataset.id ? null : row.dataset.id;
  renderSales();
});

/* ============================================================
   BOOT
   ============================================================ */

(async function boot() {
  try {
    const stats = await api('/api/stats');
    state.settings = stats.settings;
    $('#storeName').textContent = stats.settings.storeName;
  } catch { /* server may still be booting */ }
  renderCart();
  await switchView('register');
})();
