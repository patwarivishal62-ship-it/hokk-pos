# HOKK POS 🧾

A complete, modern **Point of Sale system** for the HOKK Store & Café — built with
**zero runtime dependencies** (pure Node.js backend + vanilla JS frontend).

![status](https://img.shields.io/badge/tests-12%2F12%20passing-2ecc8f)

## Features

| Area | What you get |
|---|---|
| 🛒 **Register** | Product grid with category chips & search, cart with quantity controls, per-order discount %, tax calculation, stock-aware add-to-cart |
| 💵 **Payments** | Cash (quick-tender buttons + change calculation) or card; printable receipt with store branding |
| 📊 **Dashboard** | Today's revenue / transactions / AOV / items sold, 7-day revenue chart, top products, sales by category, inventory health & low-stock alerts |
| 📦 **Inventory** | Full CRUD for products, inline stock adjustment, cost/margin tracking, SKU auto-numbering, low-stock & out-of-stock status |
| 🧾 **Sales history** | Every transaction with expandable line items, payment method, refund & restock |
| 💾 **Persistence** | Atomic JSON-file storage in `data/db.json` (auto-seeded with a café catalog on first run) |

## Quickstart

```bash
npm start          # run the POS at http://localhost:3000
npm run demo       # optional: seed ~7 days of realistic sales history
npm test           # run the API test suite (12 tests)
```

No `npm install` needed — Node ≥ 18 is the only requirement.

## REST API

| Method | Path | Description |
|---|---|---|
| GET | `/api/products?search=&category=` | List / filter products |
| POST | `/api/products` | Create product (auto SKU) |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |
| POST | `/api/sales` | Checkout — validates stock, decrements it, returns the sale |
| GET | `/api/sales?limit=` | Sales history (newest first) |
| GET | `/api/sales/:id` | Sale detail |
| POST | `/api/sales/:id/refund` | Refund a sale and restock items |
| GET | `/api/stats` | Dashboard metrics (today, 7-day trend, top products, low stock…) |

**Checkout body**

```json
{
  "items": [{ "productId": "p01", "qty": 2 }],
  "discountPct": 10,
  "paymentMethod": "cash",
  "cashTendered": 20
}
```

Totals: `subtotal → − discount → + tax (8.5%)` — all rounded to cents.

## Project structure

```
server.js          # HTTP server, REST API, JSON store, business logic
public/            # Frontend (no build step)
  index.html       #   SPA shell: register, dashboard, inventory, sales
  styles.css       #   Dark register theme
  app.js           #   Client-side state, rendering, API client
scripts/demo.js    # Demo sales generator (npm run demo)
test/api.test.js   # Integration tests (node:test + fetch)
data/db.json       # Runtime database (auto-created, git-ignored)
```

## License

MIT
