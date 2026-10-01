const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const connectDB = require("./db");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Vercel puts the function behind a proxy; this makes req.ip (used by the
// rate limiter) reflect the real client from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*" ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()) : true,
  }),
);
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// Plain liveness check — deliberately does not touch the DB so it still
// reports the function is up even if Atlas is briefly unreachable.
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Every request past this point connects (or reuses) the cached Mongo connection.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.get("/api", (req, res) => res.json({ ok: true, name: "MIJAB API", status: "running" }));

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/products", require("./routes/products.routes"));
app.use("/api/settings", require("./routes/settings.routes"));
app.use("/api/orders", require("./routes/orders.routes"));
app.use("/api/promos", require("./routes/promos.routes"));
app.use("/api/contact", require("./routes/contact.routes"));
app.use("/api/admin", require("./routes/admin"));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
