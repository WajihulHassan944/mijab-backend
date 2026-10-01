const request = require("supertest");

// app is required lazily, inside beforeAll, after tests/setup.js has set
// MONGODB_URI to the in-memory replica set — connectDB() reads the env var
// fresh on every call, so requiring app.js before or after that is fine,
// but we wait anyway for clarity.
let app;
let User, Product, Promo, Message;

beforeAll(() => {
  app = require("../src/app");
  User = require("../src/models/User");
  Product = require("../src/models/Product");
  Promo = require("../src/models/Promo");
  Message = require("../src/models/Message");
});

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
    expect(order).toMatchObject({ subtotal: 5000, discount: 500, delivery: 200, total: 4700, stage: 0, status: "placed" });

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
    expect(defaults.body.settings.deliveryFee).toBe(200);

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
