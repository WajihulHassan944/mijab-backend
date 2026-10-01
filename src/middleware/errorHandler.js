const AppError = require("../utils/AppError");

function notFound(req, res) {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ ok: false, error: err.message, details: err.details });
  }

  if (err.name === "ValidationError") {
    const details = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ ok: false, error: "Validation failed", details });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return res.status(409).json({ ok: false, error: `${field} already exists` });
  }

  if (err.name === "CastError") {
    return res.status(400).json({ ok: false, error: `Invalid ${err.path}: ${err.value}` });
  }

  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({ ok: false, error: "Invalid or expired session, please sign in again" });
  }

  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, error: "Malformed JSON body" });
  }

  console.error(err);
  return res.status(500).json({ ok: false, error: "Internal server error" });
}

module.exports = { notFound, errorHandler };
