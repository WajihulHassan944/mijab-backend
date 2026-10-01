const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

/** Requires a valid customer or admin session. */
const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw new AppError("Please sign in to continue", 401);

  const payload = verifyToken(token);
  const user = await User.findById(payload.sub);
  if (!user) throw new AppError("Account no longer exists", 401);

  req.user = user;
  next();
});

/** Attaches req.user when a valid token is present, but never blocks the request. */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (user) req.user = user;
  } catch {
    // ignore invalid/expired tokens on optional routes
  }
  next();
});

/** Must follow `protect`. Requires the authenticated user to have the admin role. */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return next(new AppError("Admin access required", 403));
  }
  next();
}

module.exports = { protect, optionalAuth, adminOnly };
