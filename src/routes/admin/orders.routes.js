const express = require("express");
const { z } = require("zod");
const Order = require("../../models/Order");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");
const { notifyOrderUpdate } = require("../../utils/pusher");

const router = express.Router();
router.use(protect, adminOnly);

const STATUSES = ["placed", "packed", "out", "delivered", "cancelled"];

function buildFilter(query) {
  const filter = {};
  if (query.status && STATUSES.includes(query.status)) filter.status = query.status;
  if (query.search) {
    const re = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ orderId: re }, { name: re }, { email: re }, { phone: re }];
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  return filter;
}

// GET /api/admin/orders — paginated, filterable list
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = buildFilter(req.query);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    res.json({
      ok: true,
      orders: orders.map((o) => o.toPublic()),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    });
  }),
);

// GET /api/admin/orders/export — CSV export (same filters as the list)
router.get(
  "/export",
  asyncHandler(async (req, res) => {
    const filter = buildFilter(req.query);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(5000);

    const header = ["Order ID", "Date", "Status", "Customer", "Email", "Phone", "City", "Items", "Subtotal", "Discount", "Delivery", "Total", "Payment"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = orders.map((o) =>
      [
        o.orderId,
        o.createdAt.toISOString(),
        o.status,
        o.name,
        o.email,
        o.phone,
        o.city,
        o.lines.map((l) => `${l.name} x${l.qty}`).join("; "),
        o.subtotal,
        o.discount,
        o.delivery,
        o.total,
        o.payment,
      ]
        .map(escape)
        .join(","),
    );
    const csv = [header.map(escape).join(","), ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="mijab-orders-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

// GET /api/admin/orders/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.id.trim().toUpperCase() });
    if (!order) throw new AppError("Order not found", 404);
    res.json({ ok: true, order: order.toPublic() });
  }),
);

// PATCH /api/admin/orders/status — bulk status update, e.g. { ids: ["MJB-10483"], status: "packed" }
router.patch(
  "/status",
  validateBody(z.object({ ids: z.array(z.string().trim().min(1)).min(1), status: z.enum(STATUSES) })),
  asyncHandler(async (req, res) => {
    const ids = req.body.ids.map((id) => id.trim().toUpperCase());
    const orders = await Order.find({ orderId: { $in: ids } });
    for (const order of orders) {
      order.status = req.body.status;
      await order.save(); // goes through the pre-validate hook so `stage` stays in sync with `status`
    }
    const publicOrders = orders.map((o) => o.toPublic());
    await Promise.all(publicOrders.map((o) => notifyOrderUpdate(o)));
    res.json({ ok: true, matched: orders.length, orders: publicOrders });
  }),
);

// PATCH /api/admin/orders/:id — update status and/or internal note on one order
router.patch(
  "/:id",
  validateBody(
    z.object({
      status: z.enum(STATUSES).optional(),
      note: z.string().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.id.trim().toUpperCase() });
    if (!order) throw new AppError("Order not found", 404);
    const statusChanged = req.body.status && req.body.status !== order.status;
    if (req.body.status) order.status = req.body.status;
    if (typeof req.body.note === "string") order.note = req.body.note;
    await order.save();
    const publicOrder = order.toPublic();
    if (statusChanged) await notifyOrderUpdate(publicOrder);
    res.json({ ok: true, order: publicOrder });
  }),
);

module.exports = router;
