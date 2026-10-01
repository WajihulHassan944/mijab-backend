const express = require("express");
const { z } = require("zod");
const Settings = require("../../models/Settings");
const asyncHandler = require("../../utils/asyncHandler");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

const updateSchema = z.object({
  storeName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).optional(),
  deliveryFee: z.number().min(0).optional(),
  freeOver: z.number().min(0).optional(),
  cod: z.boolean().optional(),
  card: z.boolean().optional(),
  bank: z.boolean().optional(),
  notifyOrders: z.boolean().optional(),
  notifyLowStock: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
  lowStockAt: z.number().min(0).optional(),
});

// GET /api/admin/settings
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton();
    res.json({ ok: true, settings });
  }),
);

// PATCH /api/admin/settings
router.patch(
  "/",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton();
    Object.assign(settings, req.body);
    await settings.save();
    res.json({ ok: true, settings });
  }),
);

module.exports = router;
