# MIJAB Backend

REST API for the MIJAB storefront and admin panel. Node.js + Express + Mongoose
(MongoDB Atlas), deployed as a single Vercel serverless function (`api/index.js`)
that wraps the whole Express app.

## Stack

- Express 4 — routing, middleware
- Mongoose 8 — MongoDB Atlas models
- JWT (`jsonwebtoken`) + `bcryptjs` — auth for customers and admins
- `zod` — request validation
- Deployed on Vercel; runs locally with a plain Node HTTP server (`local-server.js`)

## Project layout

```
api/index.js          Vercel entry point — exports the Express app
local-server.js        Local dev entry point (npm run dev / npm start)
scripts/seed.js         Creates the admin account, products, promos, settings
src/
  app.js               Express app: middleware, route mounting, error handling
  db.js                Cached MongoDB connection (safe for serverless)
  models/              Mongoose schemas
  middleware/           auth (protect/adminOnly), error handler
  routes/              auth, products, orders, promos, contact
  routes/admin/        admin auth, orders, products, promos, messages, customers, settings, analytics
  utils/               jwt, async handler, order id generator, validation, AppError
```

## Setup

1. Create a MongoDB Atlas cluster (the free M0 tier works) and a database user.
   Grab the connection string and add a database name, e.g. `/mijab`.
2. Copy `.env.example` to `.env` and fill in `MONGODB_URI` and a random `JWT_SECRET`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Seed the admin account, products, promo codes and settings:
   ```bash
   npm run seed
   ```
   By default this creates `admin@mijab.com` / `admin123` (override with
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` in `.env`). Change the
   password after your first login.
5. Run locally:
   ```bash
   npm run dev
   ```
   The API is at `http://localhost:4000/api`.

## Testing

```bash
npm test
```

This runs the Jest + supertest suite in `tests/api.test.js` against every
route — auth, order placement (including the stock transaction and its
rollback on insufficient stock), promos, admin CRUD, CSV export, settings
and analytics.

By default it spins up a disposable in-memory MongoDB replica set (needed
because order placement uses a transaction), which downloads a MongoDB
binary (several hundred MB) the first time you run it — that download can
be slow on a constrained network.

If you'd rather run the suite against a real MongoDB Atlas cluster (much
faster, no binary download), point it at a **throwaway** database on your
cluster — the suite drops that database when it finishes, but never touches
anything outside it:

```bash
TEST_MONGODB_URI="<your-atlas-uri>/mijab_test?retryWrites=true&w=majority" npm test
```

Never point `TEST_MONGODB_URI` at your real `mijab` database — the suite
creates and deletes test data freely.

## Deploying to Vercel

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Import the repo in Vercel as a new project.
3. Add the environment variables from `.env.example` in the Vercel project
   settings (`MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`).
   Set `CORS_ORIGIN` to your frontend's deployed URL(s) once you know them
   (comma-separated for multiple).
4. Deploy. Every request is routed through `api/index.js` via the rewrite in
   `vercel.json`, so the whole Express app runs as one serverless function.
5. Run `npm run seed` once against the production `MONGODB_URI` (from your
   machine, with `.env` pointed at the Atlas cluster) to create the admin
   account and starter catalog/promo data.

## Auth model

Both customers and admins are `User` documents distinguished by `role`
(`customer` | `admin`). Each issues the same kind of JWT
(`Authorization: Bearer <token>`), but admin-only routes additionally require
`role: "admin"` via the `adminOnly` middleware. There's no separate admin
collection — the seed script just creates a `User` with `role: "admin"`.

## API reference

All responses are JSON: `{ ok: true, ... }` on success, `{ ok: false, error, details? }`
on failure.

### Public / customer

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/products` | — | List active products |
| GET | `/api/products/:slug` | — | Product detail |
| POST | `/api/auth/register` | — | Create a customer account → `{ token, user }` |
| POST | `/api/auth/login` | — | Customer login → `{ token, user }` |
| GET | `/api/auth/me` | customer | Current profile |
| PATCH | `/api/auth/me` | customer | Update profile fields |
| POST | `/api/orders` | optional | Place an order (guest or signed-in); server computes totals and decrements stock |
| GET | `/api/orders/mine` | customer | Your order history |
| GET | `/api/orders/:id` | customer | Order detail (must own it, or be admin) |
| POST | `/api/orders/track` | — | `{ id, phone }` → order detail, for guest tracking |
| POST | `/api/promos/validate` | — | `{ code }` → `{ valid, percent }`, used to preview a discount |
| POST | `/api/contact` | — | Submit a contact-form message |

### Admin (`role: "admin"` required unless noted)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/admin/auth/login` | Admin login → `{ token, user }` |
| GET | `/api/admin/auth/me` | Current admin profile |
| GET | `/api/admin/orders` | List orders — query: `page`, `limit`, `status`, `search`, `from`, `to` |
| GET | `/api/admin/orders/export` | CSV export (same filters as list) |
| GET | `/api/admin/orders/:id` | Order detail |
| PATCH | `/api/admin/orders/status` | Bulk status update `{ ids: [...], status }` |
| PATCH | `/api/admin/orders/:id` | Update one order's `status` and/or internal `note` |
| GET | `/api/admin/products` | All products (active or not) |
| POST | `/api/admin/products` | Create a product |
| PATCH | `/api/admin/products/:id` | Update a product (`:id` = slug) |
| DELETE | `/api/admin/products/:id` | Delete a product |
| GET | `/api/admin/promos` | List promo codes |
| POST | `/api/admin/promos` | Create a promo code |
| PATCH | `/api/admin/promos/:code` | Update a promo code |
| DELETE | `/api/admin/promos/:code` | Delete a promo code |
| GET | `/api/admin/messages` | List contact-form messages |
| PATCH | `/api/admin/messages/:id` | Mark read/unread/replied, attach a reply |
| DELETE | `/api/admin/messages/:id` | Delete a message |
| GET | `/api/admin/customers` | Customers derived from order history |
| GET | `/api/admin/customers/:email` | One customer's profile + orders |
| GET | `/api/admin/settings` | Store settings |
| PATCH | `/api/admin/settings` | Update store settings |
| GET | `/api/admin/analytics?days=30` | Revenue by day, totals, status breakdown, top products, low stock, unread messages |

### Order placement details

- Prices and stock are always read from the database — the client only sends
  `productId` (slug) and `qty`. This prevents price tampering.
- Stock is checked and decremented atomically inside a MongoDB transaction; if
  any line is out of stock the whole order is rejected and nothing changes.
- Delivery fee and the free-delivery threshold come from `/api/admin/settings`.
- A promo code is re-validated server-side even if the client already called
  `/api/promos/validate`.
- Order IDs are sequential and human-friendly (`MJB-10483`, `MJB-10484`, ...),
  generated via an atomic counter.

## Notes

- Mongo connections are cached on the Node global object (`src/db.js`) so
  repeated invocations of the same warm serverless function reuse the
  connection instead of opening a new one per request.
- CORS defaults to `*`. Set `CORS_ORIGIN` to a comma-separated list of allowed
  origins before going to production.
