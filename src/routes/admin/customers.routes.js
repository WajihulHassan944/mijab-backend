const express = require("express");
const Order = require("../../models/Order");
const asyncHandler = require("../../utils/asyncHandler");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

// GET /api/admin/customers — customers derived from order history (excludes cancelled orders)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const customers = await Order.aggregate([
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$email",
          name: { $last: "$name" },
          phone: { $last: "$phone" },
          city: { $last: "$city" },
          first: { $min: "$createdAt" },
          last: { $max: "$createdAt" },
          orders: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, 1] } },
          spent: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } },
        },
      },
      { $match: { orders: { $gt: 0 } } },
      { $project: { _id: 0, email: "$_id", name: 1, phone: 1, city: 1, first: 1, last: 1, orders: 1, spent: 1 } },
      { $sort: { spent: -1 } },
    ]);
    res.json({ ok: true, customers });
  }),
);

// GET /api/admin/customers/:email — a single customer's profile + order history
router.get(
  "/:email",
  asyncHandler(async (req, res) => {
    const email = req.params.email.toLowerCase();
    const orders = await Order.find({ email }).sort({ createdAt: -1 });
    if (orders.length === 0) return res.json({ ok: true, customer: null, orders: [] });

    const active = orders.filter((o) => o.status !== "cancelled");
    const customer = {
      email,
      name: orders[0].name,
      phone: orders[0].phone,
      city: orders[0].city,
      orders: active.length,
      spent: active.reduce((sum, o) => sum + o.total, 0),
      first: orders[orders.length - 1].createdAt,
      last: orders[0].createdAt,
    };
    res.json({ ok: true, customer, orders: orders.map((o) => o.toPublic()) });
  }),
);

module.exports = router;
