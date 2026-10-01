const express = require("express");
const { z } = require("zod");
const User = require("../models/User");
const { signToken } = require("../utils/jwt");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateBody } = require("../utils/validate");
const { protect } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  email: z.string().trim().email("Enter a valid email").toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
});

// POST /api/auth/register
router.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) throw new AppError("An account with this email already exists", 409);

    const user = await User.create({ ...req.body, role: "customer" });
    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.status(201).json({ ok: true, token, user: user.toPublic() });
  }),
);

// POST /api/auth/login
router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError("Invalid email or password", 401);
    }
    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.json({ ok: true, token, user: user.toPublic() });
  }),
);

// GET /api/auth/me
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, user: req.user.toPublic() });
  }),
);

// PATCH /api/auth/me
router.patch(
  "/me",
  protect,
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    Object.assign(req.user, req.body);
    await req.user.save();
    res.json({ ok: true, user: req.user.toPublic() });
  }),
);

module.exports = router;
