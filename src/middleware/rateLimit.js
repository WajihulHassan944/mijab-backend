const rateLimit = require("express-rate-limit");

// Applied to login/register endpoints to slow down credential stuffing and
// brute-force attempts. Keyed by IP; Vercel/trust proxy is configured in
// app.js so req.ip reflects the real client, not the edge network.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many attempts, please try again later" },
});

// Looser limit for other public write endpoints (contact form, order
// tracking, promo lookups, checkout) — generous enough for real shoppers,
// tight enough to blunt scripted spam/enumeration.
const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, please slow down" },
});

module.exports = { authLimiter, publicWriteLimiter };
