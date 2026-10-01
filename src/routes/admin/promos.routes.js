const express = require("express");
const { z } = require("zod");
const Promo = require("../../models/Promo");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

const createSchema = z.object({
  code: z.string().trim().min(2).max(40),
  percent: z.number().min(1).max(100),
  active: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

const updateSchema = z.object({
  percent: z.number().min(1).max(100).optional(),
  active: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

// GET /api/admin/promos
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const promos = await Promo.find().sort({ createdAt: -1 });
    res.json({ ok: true, promos });
  }),
);

// POST /api/admin/promos
router.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const promo = await Promo.create({ ...req.body, code: req.body.code.toUpperCase() });
    res.status(201).json({ ok: true, promo });
  }),
);

// PATCH /api/admin/promos/:code
router.patch(
  "/:code",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const promo = await Promo.findOneAndUpdate({ code: req.params.code.toUpperCase() }, req.body, {
      new: true,
      runValidators: true,
    });
    if (!promo) throw new AppError("Promo code not found", 404);
    res.json({ ok: true, promo });
  }),
);

// DELETE /api/admin/promos/:code
router.delete(
  "/:code",
  asyncHandler(async (req, res) => {
    const promo = await Promo.findOneAndDelete({ code: req.params.code.toUpperCase() });
    if (!promo) throw new AppError("Promo code not found", 404);
    res.json({ ok: true });
  }),
);

module.exports = router;
