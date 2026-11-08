const request = require("supertest");
const crypto = require("crypto");

// app is required lazily, inside beforeAll, after tests/setup.js has set
// MONGODB_URI to the in-memory replica set — connectDB() reads the env var
// fresh on every call, so requiring app.js before or after that is fine,
// but we wait anyway for clarity.
let app;
let User, Product, Promo, Message, Order;

beforeAll(() => {
  // Fake-but-present Safepay credentials: enough for isConfigured() to be
  // true and the 404/400 validation paths to be reachable, without ever
  // making a real network call to Safepay (nothing in these tests does).
  process.env.SAFEPAY_PUBLIC_KEY = process.env.SAFEPAY_PUBLIC_KEY || "sec_test";
  process.env.SAFEPAY_SECRET_KEY = process.env.SAFEPAY_SECRET_KEY || "test-secret";
  process.env.SAFEPAY_WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET || "test-webhook-secret";

  app = require("../src/app");
  User = require("../src/models/User");
  Product = require("../src/models/Product");
  Promo = require("../src/models/Promo");
  Message = require("../src/models/Message");
  Order = require("../src/models/Order");
});

function signWebhook(payload) {
  return crypto.createHmac("sha512", process.env.SAFEPAY_WEBHOOK_SECRET).update(Buffer.from(JSON.stringify(payload))).digest("hex");
}

async function seedCatalog() {
  await User.create({ name: "MIJAB Admin", email: "admin@mijab.com", password: "admin123", role: "admin" });
  await Product.create({ slug: "cafe-noir", sku: "MJB-CN-50", name: "Café Noir", price: 2500, stock: 5, active: true });
  await Product.create({ slug: "vanilla-gourmand", sku: "MJB-VG-50", name: "Vanilla Gourmand", price: 2500, stock: 1, active: true });
  await Promo.create({ code: "WELCOME10", percent: 10, active: true, note: "test" });
}

async function adminToken() {
  const res = await request(app).post("/api/admin/auth/login").send({ email: "admin@mijab.com", password: "admin123" });
  return res.body.token;
}

describe("health", () => {
  it("responds ok without touching the database", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("products", () => {
  beforeAll(seedCatalog);

  it("lists only active products", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(2);
  });

  it("404s for an unknown slug", async () => {
    const res = await request(app).get("/api/products/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("public settings", () => {
  it("exposes only the storefront-relevant fields, no auth required", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ deliveryFee: 350, freeOver: 0, cod: true, card: true, bank: true });
    expect(res.body.settings.lowStockAt).toBeUndefined();
    expect(res.body.settings.notifyOrders).toBeUndefined();
  });
});

describe("promo validation", () => {
  it("is case-insensitive for valid codes", async () => {
    const res = await request(app).post("/api/promos/validate").send({ code: "welcome10" });
    expect(res.body).toMatchObject({ ok: true, valid: true, percent: 10 });
  });

  it("returns valid:false for unknown codes, not an error", async () => {
    const res = await request(app).post("/api/promos/validate").send({ code: "NOPE" });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });
});

describe("customer auth", () => {
  it("registers, rejects duplicate email, and rejects bad login", async () => {
    const reg = await request(app).post("/api/auth/register").send({ name: "Ayesha Khan", email: "ayesha@example.com", password: "secret123" });
    expect(reg.status).toBe(201);
    expect(reg.body.token).toBeTruthy();

    const dup = await request(app).post("/api/auth/register").send({ name: "Dup", email: "ayesha@example.com", password: "secret123" });
    expect(dup.status).toBe(409);

    const badLogin = await request(app).post("/api/auth/login").send({ email: "ayesha@example.com", password: "wrong" });
    expect(badLogin.status).toBe(401);
  });

  it("rejects requests without a token and accepts a valid one", async () => {
    const noToken = await request(app).get("/api/auth/me");
    expect(noToken.status).toBe(401);

    const login = await request(app).post("/api/auth/login").send({ email: "ayesha@example.com", password: "secret123" });
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("ayesha@example.com");
  });
});

describe("admin access control", () => {
  it("logs an admin in and blocks a customer token from admin routes", async () => {
    const admin = await adminToken();
    expect(admin).toBeTruthy();

    const customerLogin = await request(app).post("/api/auth/login").send({ email: "ayesha@example.com", password: "secret123" });
    const blocked = await request(app).get("/api/admin/orders").set("Authorization", `Bearer ${customerLogin.body.token}`);
    expect(blocked.status).toBe(403);
  });
});

describe("order placement", () => {
  it("computes totals server-side, applies a promo, and decrements stock atomically", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({
        lines: [{ productId: "cafe-noir", qty: 2 }],
        promoCode: "WELCOME10",
        name: "Ayesha Khan",
        address: "House 12",
        city: "Islamabad",
        email: "ayesha@example.com",
        phone: "03000000000",
        payment: "Cash on delivery",
      });

    expect(res.status).toBe(201);
    const order = res.body.order;
    expect(order.id).toMatch(/^MJB-\d+$/);
    expect(order).toMatchObject({ subtotal: 5000, discount: 500, delivery: 350, total: 4850, stage: 0, status: "placed" });

    const cn = await Product.findOne({ slug: "cafe-noir" });
    expect(cn.stock).toBe(3);
  });

  it("rejects an order that exceeds stock and leaves stock untouched", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({
        lines: [{ productId: "vanilla-gourmand", qty: 5 }],
        name: "X",
        address: "Y",
        city: "Z",
        email: "x@example.com",
        phone: "0301111111",
        payment: "Cash on delivery",
      });

    expect(res.status).toBe(409);
    const vg = await Product.findOne({ slug: "vanilla-gourmand" });
    expect(vg.stock).toBe(1);
  });

  it("tracks an order by id + phone, normalizing phone formatting, and rejects a wrong phone", async () => {
    const placed = await request(app)
      .post("/api/orders")
      .send({
        lines: [{ productId: "cafe-noir", qty: 1 }],
        name: "Track Test",
        address: "Addr",
        city: "City",
        email: "track@example.com",
        phone: "0300-000-0001",
        payment: "Cash on delivery",
      });
    const id = placed.body.order.id;

    const ok = await request(app).post("/api/orders/track").send({ id: id.toLowerCase(), phone: "03000000001" });
    expect(ok.status).toBe(200);
    expect(ok.body.order.id).toBe(id);

    const wrong = await request(app).post("/api/orders/track").send({ id, phone: "0399999999" });
    expect(wrong.status).toBe(404);
  });
});

describe("payment proof upload", () => {
  // Built directly on the Order model, not through POST /api/orders, so
  // these tests don't touch real product stock shared with other tests.
  async function createBankTransferOrder(phone) {
    return Order.create({
      orderId: `MJB-PROOF-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      lines: [{ productId: "cafe-noir", name: "Café Noir", price: 2500, qty: 1 }],
      subtotal: 2500,
      total: 2500,
      name: "Bank Transfer Test",
      address: "Addr",
      city: "City",
      email: "bank@example.com",
      phone,
      payment: "Bank transfer",
    });
  }

  it("rejects a mismatched phone before ever touching Cloudinary", async () => {
    const order = await createBankTransferOrder("0300-111-2222");

    const wrongPhone = await request(app)
      .post(`/api/orders/${order.orderId}/payment-proof`)
      .field("phone", "0399999999")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "proof.png");
    expect(wrongPhone.status).toBe(404);
  });

  it("returns a clear 503 when Cloudinary isn't configured", async () => {
    const order = await createBankTransferOrder("03001112223");

    const res = await request(app)
      .post(`/api/orders/${order.orderId}/payment-proof`)
      .field("phone", "03001112223")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "proof.png");
    expect(res.status).toBe(503);
  });
});

describe("admin orders", () => {
  it("lists orders and supports bulk status updates that keep stage in sync", async () => {
    const admin = await adminToken();
    const list = await request(app).get("/api/admin/orders").set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.orders.length).toBeGreaterThan(0);

    const id = list.body.orders[0].id;
    const bulk = await request(app)
      .patch("/api/admin/orders/status")
      .set("Authorization", `Bearer ${admin}`)
      .send({ ids: [id], status: "packed" });

    expect(bulk.status).toBe(200);
    expect(bulk.body.orders[0]).toMatchObject({ status: "packed", stage: 1 });
  });

  it("exports orders as CSV", async () => {
    const admin = await adminToken();
    const res = await request(app).get("/api/admin/orders/export").set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.startsWith('"Order ID"')).toBe(true);
  });
});

describe("admin status change emails the customer", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
  });

  it("sends a Brevo email on bulk and single status changes, with a review link once delivered", async () => {
    process.env.BREVO_API_KEY = "test-key";
    process.env.BREVO_SENDER_EMAIL = "store@example.com";
    process.env.FRONTEND_URL = "https://shop.example.com";
    const sent = [];
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).includes("brevo")) sent.push(JSON.parse(opts.body));
      return { ok: true, text: async () => "" };
    });

    const order = await Order.create({
      orderId: `MJB-MAIL-${Date.now()}`,
      lines: [{ productId: "cafe-noir", name: "Café Noir", price: 2500, qty: 1 }],
      subtotal: 2500, total: 2500, name: "Mail Test", address: "Addr", city: "City",
      email: "mailtest@example.com", phone: "03001234567", payment: "Cash on delivery",
    });
    const admin = await adminToken();

    await request(app).patch("/api/admin/orders/status").set("Authorization", `Bearer ${admin}`).send({ ids: [order.orderId], status: "packed" }).expect(200);
    await request(app).patch(`/api/admin/orders/${order.orderId}`).set("Authorization", `Bearer ${admin}`).send({ status: "delivered" }).expect(200);
    // same status again: no new email
    await request(app).patch("/api/admin/orders/status").set("Authorization", `Bearer ${admin}`).send({ ids: [order.orderId], status: "delivered" }).expect(200);

    const toCustomer = sent.filter((m) => m.to.some((r) => r.email === "mailtest@example.com"));
    expect(toCustomer.map((m) => m.subject)).toEqual([`Your order is packed — ${order.orderId}`, `Your order has been delivered — ${order.orderId}`]);
    expect(toCustomer[1].htmlContent).toContain(`https://shop.example.com/review?order=${order.orderId}`);
  });
});

describe("reviews", () => {
  async function makeOrder(status) {
    return Order.create({
      orderId: `MJB-REV-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
      lines: [{ productId: "cafe-noir", name: "Café Noir", price: 2500, qty: 1 }],
      subtotal: 2500, total: 2500, name: "Sara Khan", address: "Addr", city: "Lahore, Punjab",
      email: "sara@example.com", phone: "0300-555-1234", payment: "Cash on delivery", status,
    });
  }

  it("only accepts reviews for delivered orders with the matching phone", async () => {
    const pending = await makeOrder("out");
    const notYet = await request(app).post("/api/reviews").send({ orderId: pending.orderId, phone: "03005551234", rating: 5, body: "Lovely scent, lasts all day." });
    expect(notYet.status).toBe(400);

    const delivered = await makeOrder("delivered");
    const wrongPhone = await request(app).post("/api/reviews").send({ orderId: delivered.orderId, phone: "0399", rating: 5, body: "Lovely scent, lasts all day." });
    expect(wrongPhone.status).toBe(404);

    const elig = await request(app).post("/api/reviews/eligibility").send({ orderId: delivered.orderId.toLowerCase(), phone: "03005551234" });
    expect(elig.body).toMatchObject({ eligible: true, name: "Sara Khan" });

    const ok = await request(app).post("/api/reviews").send({ orderId: delivered.orderId, phone: "03005551234", rating: 4, body: "Lovely scent, lasts all day." });
    expect(ok.status).toBe(201);

    const dup = await request(app).post("/api/reviews").send({ orderId: delivered.orderId, phone: "03005551234", rating: 5, body: "Trying to review twice here." });
    expect(dup.status).toBe(409);
  });

  it("keeps reviews off the public list until an admin approves them", async () => {
    const order = await makeOrder("delivered");
    const created = await request(app).post("/api/reviews").send({ orderId: order.orderId, phone: "03005551234", rating: 5, body: "Absolutely beautiful fragrance." });
    const id = created.body.review.id;

    let pub = await request(app).get("/api/reviews");
    expect(pub.body.reviews.find((r) => r.id === id)).toBeUndefined();

    const admin = await adminToken();
    const pendingList = await request(app).get("/api/admin/reviews?status=pending").set("Authorization", `Bearer ${admin}`);
    expect(pendingList.body.reviews.find((r) => r.id === id)).toMatchObject({ status: "pending", orderId: order.orderId, city: "Lahore" });

    await request(app).patch(`/api/admin/reviews/${id}`).set("Authorization", `Bearer ${admin}`).send({ status: "approved" }).expect(200);
    pub = await request(app).get("/api/reviews");
    const shown = pub.body.reviews.find((r) => r.id === id);
    expect(shown).toMatchObject({ rating: 5, name: "Sara Khan" });
    expect(shown.email).toBeUndefined();
    expect(shown.orderId).toBeUndefined();

    await request(app).patch(`/api/admin/reviews/${id}`).set("Authorization", `Bearer ${admin}`).send({ status: "rejected" }).expect(200);
    pub = await request(app).get("/api/reviews");
    expect(pub.body.reviews.find((r) => r.id === id)).toBeUndefined();

    await request(app).delete(`/api/admin/reviews/${id}`).set("Authorization", `Bearer ${admin}`).expect(200);
    const noAuth = await request(app).get("/api/admin/reviews");
    expect(noAuth.status).toBe(401);
  });
});

describe("admin products", () => {
  it("creates, updates, and hides a product from the public catalog when inactive", async () => {
    const admin = await adminToken();
    const create = await request(app)
      .post("/api/admin/products")
      .set("Authorization", `Bearer ${admin}`)
      .send({ slug: "duo", sku: "MJB-DUO-100", name: "The Duo", price: 4500, stock: 10, notes: { top: "A", heart: "B", base: "C" } });
    expect(create.status).toBe(201);

    const update = await request(app)
      .patch("/api/admin/products/duo")
      .set("Authorization", `Bearer ${admin}`)
      .send({ price: 4800, active: false, notes: { top: "Updated top only" } });
    expect(update.status).toBe(200);
    expect(update.body.product.price).toBe(4800);
    expect(update.body.product.active).toBe(false);
    // partial notes update must merge, not wipe heart/base
    expect(update.body.product.notes).toMatchObject({ top: "Updated top only", heart: "B", base: "C" });

    const hidden = await request(app).get("/api/products/duo");
    expect(hidden.status).toBe(404);
  });
});

describe("admin promos", () => {
  it("creates a promo code and uppercases it", async () => {
    const admin = await adminToken();
    const res = await request(app)
      .post("/api/admin/promos")
      .set("Authorization", `Bearer ${admin}`)
      .send({ code: "eid20", percent: 20, note: "eid" });
    expect(res.status).toBe(201);
    expect(res.body.promo.code).toBe("EID20");
  });
});

describe("contact + admin messages", () => {
  it("submits a message and lets admin mark it replied", async () => {
    const admin = await adminToken();
    const submit = await request(app).post("/api/contact").send({ name: "Bilal", email: "bilal@example.com", subject: "Hi", body: "Ship outside PK?" });
    expect(submit.status).toBe(201);

    const list = await request(app).get("/api/admin/messages").set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    const msg = list.body.messages.find((m) => m.email === "bilal@example.com");
    expect(msg).toBeTruthy();

    const reply = await request(app)
      .patch(`/api/admin/messages/${msg._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ state: "replied", reply: "Yes we do!" });
    expect(reply.status).toBe(200);
    expect(reply.body.message.state).toBe("replied");
  });
});

describe("settings and free delivery threshold", () => {
  it("applies free delivery once the subtotal crosses the configured threshold", async () => {
    const admin = await adminToken();
    const defaults = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${admin}`);
    expect(defaults.body.settings.deliveryFee).toBe(350);

    await request(app).patch("/api/admin/settings").set("Authorization", `Bearer ${admin}`).send({ freeOver: 1000 });

    const order = await request(app)
      .post("/api/orders")
      .send({
        lines: [{ productId: "cafe-noir", qty: 1 }],
        name: "Free Delivery Test",
        address: "Addr",
        city: "City",
        email: "free@example.com",
        phone: "0302222222",
        payment: "Cash on delivery",
      });
    expect(order.status).toBe(201);
    expect(order.body.order.delivery).toBe(0);

    // reset so other tests keep seeing the default delivery fee
    await request(app).patch("/api/admin/settings").set("Authorization", `Bearer ${admin}`).send({ freeOver: 0 });
  });
});

describe("store pickup", () => {
  beforeAll(async () => {
    // own product so these orders don't eat stock other tests rely on
    await Product.create({ slug: "pickup-test", sku: "MJB-PT-50", name: "Pickup Test", price: 1000, stock: 20, active: true });
  });

  const base = { lines: [{ productId: "pickup-test", qty: 1 }], name: "Pickup Test", email: "pickup@example.com", phone: "03004445555", payment: "Cash on delivery" };

  it("charges no delivery fee and needs no address", async () => {
    const admin = await adminToken();
    await request(app).patch("/api/admin/settings").set("Authorization", `Bearer ${admin}`).send({ pickupAddress: "MIJAB Studio, F-7 Markaz, Islamabad (11am–7pm)" });

    const pub = await request(app).get("/api/settings");
    expect(pub.body.settings).toMatchObject({ pickup: true, pickupAddress: "MIJAB Studio, F-7 Markaz, Islamabad (11am–7pm)" });

    const res = await request(app).post("/api/orders").send({ ...base, fulfillment: "pickup" });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ fulfillment: "pickup", delivery: 0, total: 1000, city: "Store pickup", address: "MIJAB Studio, F-7 Markaz, Islamabad (11am–7pm)" });

    // the same order delivered still pays the fee
    const delivered = await request(app).post("/api/orders").send({ ...base, address: "Addr", city: "City" });
    expect(delivered.status).toBe(201);
    expect(delivered.body.order).toMatchObject({ fulfillment: "delivery", delivery: 350, total: 1350 });
  });

  it("still requires an address for delivery orders", async () => {
    const res = await request(app).post("/api/orders").send({ ...base });
    expect(res.status).toBe(400);
  });

  it("rejects pickup when the admin has switched it off", async () => {
    const admin = await adminToken();
    await request(app).patch("/api/admin/settings").set("Authorization", `Bearer ${admin}`).send({ pickup: false });
    const res = await request(app).post("/api/orders").send({ ...base, fulfillment: "pickup" });
    expect(res.status).toBe(400);
    await request(app).patch("/api/admin/settings").set("Authorization", `Bearer ${admin}`).send({ pickup: true, pickupAddress: "" });
  });
});

describe("admin analytics and customers", () => {
  it("aggregates orders into customers and analytics totals", async () => {
    const admin = await adminToken();

    const customers = await request(app).get("/api/admin/customers").set("Authorization", `Bearer ${admin}`);
    expect(customers.status).toBe(200);
    const ayesha = customers.body.customers.find((c) => c.email === "ayesha@example.com");
    expect(ayesha).toBeTruthy();
    expect(ayesha.orders).toBeGreaterThanOrEqual(1);

    const analytics = await request(app).get("/api/admin/analytics").set("Authorization", `Bearer ${admin}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.analytics.totals.orders).toBeGreaterThan(0);
  });
});

describe("safepay checkout session", () => {
  it("404s for an order that doesn't exist", async () => {
    const res = await request(app).post("/api/payments/safepay/checkout").send({ orderId: "MJB-00000" });
    expect(res.status).toBe(404);
  });

  it("rejects a checkout session for an order that isn't awaiting card payment", async () => {
    await Product.updateOne({ slug: "cafe-noir" }, { $set: { stock: 10 } });
    const placed = await request(app).post("/api/orders").send({
      lines: [{ productId: "cafe-noir", qty: 1 }],
      name: "COD Payment Session Test", address: "Addr", city: "City", email: "codpaysession@example.com", phone: "0301112222", payment: "Cash on delivery",
    });
    expect(placed.body.order.paymentStatus).toBe("not_required");

    const res = await request(app).post("/api/payments/safepay/checkout").send({ orderId: placed.body.order.id });
    expect(res.status).toBe(400);
  });

  it("marks a card order pending (not confirmed) until a webhook says otherwise", async () => {
    await Product.updateOne({ slug: "cafe-noir" }, { $set: { stock: 10 } });
    const placed = await request(app).post("/api/orders").send({
      lines: [{ productId: "cafe-noir", qty: 1 }],
      name: "Card Payment Session Test", address: "Addr", city: "City", email: "cardpaysession@example.com", phone: "0301112223", payment: "Debit or credit card",
    });
    expect(placed.status).toBe(201);
    expect(placed.body.order.paymentStatus).toBe("pending");
  });
});

describe("safepay webhook", () => {
  it("rejects a webhook with an invalid signature", async () => {
    const res = await request(app)
      .post("/api/payments/safepay/webhook")
      .set("x-sfpy-signature", "not-a-real-signature")
      .send({ type: "payment.succeeded", data: { metadata: { order_id: "MJB-00000" } } });
    expect(res.status).toBe(401);
  });

  it("marks the order paid on a correctly signed payment.succeeded event", async () => {
    await Product.updateOne({ slug: "vanilla-gourmand" }, { $set: { stock: 10 } });
    const placed = await request(app).post("/api/orders").send({
      lines: [{ productId: "vanilla-gourmand", qty: 1 }],
      name: "Webhook Success Test", address: "Addr", city: "City", email: "webhooksuccess@example.com", phone: "0301112224", payment: "Debit or credit card",
    });
    const orderId = placed.body.order.id;

    const payload = { type: "payment.succeeded", data: { tracker: "track_test", metadata: { order_id: orderId }, amount: placed.body.order.total * 100, currency: "PKR" } };
    const res = await request(app).post("/api/payments/safepay/webhook").set("x-sfpy-signature", signWebhook(payload)).send(payload);
    expect(res.status).toBe(200);

    const order = await Order.findOne({ orderId });
    expect(order.paymentStatus).toBe("paid");
  });

  it("cancels the order and restores stock on a correctly signed payment.failed event", async () => {
    // reset to a known baseline — earlier tests in this file share the same
    // seeded products, so don't rely on however much they left behind
    await Product.updateOne({ slug: "vanilla-gourmand" }, { $set: { stock: 10 } });

    const placed = await request(app).post("/api/orders").send({
      lines: [{ productId: "vanilla-gourmand", qty: 1 }],
      name: "Webhook Failure Test", address: "Addr", city: "City", email: "webhookfailure@example.com", phone: "0301112225", payment: "Debit or credit card",
    });
    const orderId = placed.body.order.id;
    expect((await Product.findOne({ slug: "vanilla-gourmand" })).stock).toBe(9); // reserved while pending

    const payload = { type: "payment.failed", data: { tracker: "track_test", metadata: { order_id: orderId }, message: "card declined" } };
    const res = await request(app).post("/api/payments/safepay/webhook").set("x-sfpy-signature", signWebhook(payload)).send(payload);
    expect(res.status).toBe(200);

    const order = await Order.findOne({ orderId });
    expect(order.paymentStatus).toBe("failed");
    expect(order.status).toBe("cancelled");
    expect((await Product.findOne({ slug: "vanilla-gourmand" })).stock).toBe(10); // released back
  });
});

describe("admin cancelling an order restores stock", () => {
  it("releases reserved stock when an admin cancels a placed order", async () => {
    const admin = await adminToken();
    await Product.updateOne({ slug: "cafe-noir" }, { $set: { stock: 10 } });

    const placed = await request(app).post("/api/orders").send({
      lines: [{ productId: "cafe-noir", qty: 1 }],
      name: "Admin Cancel Restock Test", address: "Addr", city: "City", email: "admincancelrestock@example.com", phone: "0301112226", payment: "Cash on delivery",
    });
    const orderId = placed.body.order.id;
    expect((await Product.findOne({ slug: "cafe-noir" })).stock).toBe(9);

    const cancelled = await request(app)
      .patch(`/api/admin/orders/${orderId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);

    expect((await Product.findOne({ slug: "cafe-noir" })).stock).toBe(10);
  });
});
