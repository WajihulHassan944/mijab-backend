const express = require("express");
const Order = require("../../models/Order");
const Product = require("../../models/Product");
const Message = require("../../models/Message");
const Settings = require("../../models/Settings");
const asyncHandler = require("../../utils/asyncHandler");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

// GET /api/admin/analytics?days=30
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const settings = await Settings.getSingleton();

    const [revenueByDay, totals, byStatus, topProducts, lowStock, unreadMessages] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: since }, status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: "$_id", revenue: 1, orders: 1 } },
        { $sort: { date: 1 } },
      ]),
      Order.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        { $unwind: "$lines" },
        {
          $group: {
            _id: "$lines.productId",
            name: { $last: "$lines.name" },
            qty: { $sum: "$lines.qty" },
            revenue: { $sum: { $multiply: ["$lines.price", "$lines.qty"] } },
          },
        },
        { $project: { _id: 0, productId: "$_id", name: 1, qty: 1, revenue: 1 } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      Product.find({ active: true, stock: { $lte: settings.lowStockAt } }).sort({ stock: 1 }).limit(50),
      Message.countDocuments({ state: "unread" }),
    ]);

    const customers = await Order.distinct("email", { status: { $ne: "cancelled" } });
    const statusMap = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    const revenue = totals[0]?.revenue ?? 0;
    const orderCount = totals[0]?.orders ?? 0;

    res.json({
      ok: true,
      analytics: {
        days,
        revenueByDay,
        totals: {
          revenue,
          orders: orderCount,
          customers: customers.length,
          averageOrderValue: orderCount ? Math.round(revenue / orderCount) : 0,
        },
        byStatus: {
          placed: statusMap.placed || 0,
          packed: statusMap.packed || 0,
          out: statusMap.out || 0,
          delivered: statusMap.delivered || 0,
          cancelled: statusMap.cancelled || 0,
        },
        topProducts,
        lowStockProducts: lowStock.map((p) => p.toPublic()),
        unreadMessages,
      },
    });
  }),
);

module.exports = router;
