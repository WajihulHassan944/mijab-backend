const express = require("express");
const { z } = require("zod");
const User = require("../../models/User");
const { signToken } = require("../../utils/jwt");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");
const { authLimiter } = require("../../middleware/rateLimit");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

// POST /api/admin/auth/login
router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, role: "admin" }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError("Invalid email or password", 401);
    }
    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.json({ ok: true, token, user: user.toPublic() });
  }),
);

// GET /api/admin/auth/me
router.get(
  "/me",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, user: req.user.toPublic() });
  }),
);

module.exports = router;
