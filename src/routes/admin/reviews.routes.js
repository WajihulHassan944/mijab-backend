const express = require("express");
const { z } = require("zod");
const Review = require("../../models/Review");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

const STATUSES = ["pending", "approved", "rejected"];

// GET /api/admin/reviews?status=pending
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
    const reviews = await Review.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ ok: true, reviews: reviews.map((r) => r.toAdmin()) });
  }),
);

// PATCH /api/admin/reviews/:id — approve / reject (hide)
router.patch(
  "/:id",
  validateBody(z.object({ status: z.enum(STATUSES) })),
  asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id).catch(() => null);
    if (!review) throw new AppError("Review not found", 404);
    review.status = req.body.status;
    await review.save();
    res.json({ ok: true, review: review.toAdmin() });
  }),
);

// DELETE /api/admin/reviews/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const review = await Review.findByIdAndDelete(req.params.id).catch(() => null);
    if (!review) throw new AppError("Review not found", 404);
    res.json({ ok: true });
  }),
);

module.exports = router;
