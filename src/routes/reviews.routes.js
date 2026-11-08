const express = require("express");
const { z } = require("zod");
const Order = require("../models/Order");
const Review = require("../models/Review");
const Settings = require("../models/Settings");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateBody } = require("../utils/validate");
const { publicWriteLimiter } = require("../middleware/rateLimit");
const { sendAdminNewReviewAlert } = require("../utils/email");

const router = express.Router();

const digits = (s) => (s || "").replace(/\D/g, "");

// GET /api/reviews — approved reviews only, newest first (homepage)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 6));
    const reviews = await Review.find({ status: "approved" }).sort({ createdAt: -1 }).limit(limit);
    res.json({ ok: true, reviews: reviews.map((r) => r.toPublic()) });
  }),
);

// POST /api/reviews/eligibility — can this order be reviewed? Same id+phone
// gate as /orders/track so a guessed order id alone reveals nothing.
router.post(
  "/eligibility",
  publicWriteLimiter,
  validateBody(z.object({ orderId: z.string().trim().min(1), phone: z.string().trim().min(1) })),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.body.orderId.toUpperCase() });
    if (!order || digits(order.phone) !== digits(req.body.phone)) {
      throw new AppError("We couldn't find an order with that ID and phone number", 404);
    }
    const existing = await Review.exists({ orderId: order.orderId });
    res.json({
      ok: true,
      eligible: order.status === "delivered" && !existing,
      reason: existing ? "reviewed" : order.status !== "delivered" ? "not_delivered" : null,
      name: order.name,
      products: order.lines.map((l) => l.name),
    });
  }),
);

// POST /api/reviews — submit a review for a delivered order. Goes in as
// "pending"; it only appears on the site once an admin approves it.
router.post(
  "/",
  publicWriteLimiter,
  validateBody(
    z.object({
      orderId: z.string().trim().min(1),
      phone: z.string().trim().min(1),
      rating: z.number().int().min(1).max(5),
      body: z.string().trim().min(10, "Please write at least a few words").max(1000),
      name: z.string().trim().min(1).max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.body.orderId.toUpperCase() });
    if (!order || digits(order.phone) !== digits(req.body.phone)) {
      throw new AppError("We couldn't find an order with that ID and phone number", 404);
    }
    if (order.status !== "delivered") throw new AppError("You can review your order once it has been delivered", 400);
    if (await Review.exists({ orderId: order.orderId })) throw new AppError("You've already reviewed this order — thank you!", 409);

    let review;
    try {
      review = await Review.create({
        orderId: order.orderId,
        name: req.body.name || order.name,
        city: (order.city || "").split(",")[0].trim(),
        email: order.email,
        products: order.lines.map((l) => l.name),
        rating: req.body.rating,
        body: req.body.body,
      });
    } catch (err) {
      if (err.code === 11000) throw new AppError("You've already reviewed this order — thank you!", 409);
      throw err;
    }

    const settings = await Settings.getSingleton();
    await sendAdminNewReviewAlert(review.toAdmin(), settings.email).catch(() => {});

    res.status(201).json({ ok: true, review: review.toPublic() });
  }),
);

module.exports = router;
