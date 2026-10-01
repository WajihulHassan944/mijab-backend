const express = require("express");
const { z } = require("zod");
const Promo = require("../models/Promo");
const asyncHandler = require("../utils/asyncHandler");
const { validateBody } = require("../utils/validate");

const router = express.Router();

const codeSchema = z.object({ code: z.string().trim().min(1).max(40) });

// POST /api/promos/validate — used by the cart/checkout to preview a discount
router.post(
  "/validate",
  validateBody(codeSchema),
  asyncHandler(async (req, res) => {
    const code = req.body.code.toUpperCase();
    const promo = await Promo.findOne({ code, active: true });
    if (!promo) return res.json({ ok: true, valid: false });
    res.json({ ok: true, valid: true, code: promo.code, percent: promo.percent });
  }),
);

module.exports = router;
