const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Promo = require("../models/Promo");
const Settings = require("../models/Settings");
const nextOrderId = require("../utils/orderId");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateBody } = require("../utils/validate");
const { protect, optionalAuth } = require("../middleware/auth");
const { publicWriteLimiter } = require("../middleware/rateLimit");
const { notifyNewOrder, notifyOrderUpdate } = require("../utils/pusher");
const { sendOrderConfirmation, sendAdminNewOrderAlert, sendAdminLowStockAlert } = require("../utils/email");

const router = express.Router();

const placeOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        qty: z.number().int().min(1).max(10),
      }),
    )
    .min(1, "Your bag is empty"),
  promoCode: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().min(5).max(30),
  payment: z.string().trim().min(1).max(60),
});

const digits = (s) => (s || "").replace(/\D/g, "");

// POST /api/orders — place an order (guest checkout, or attached to the signed-in user)
router.post(
  "/",
  publicWriteLimiter,
  optionalAuth,
  validateBody(placeOrderSchema),
  asyncHandler(async (req, res) => {
    const { lines, promoCode, name, address, city, email, phone, payment } = req.body;

    const session = await mongoose.startSession();
    let order;
    let settingsSnapshot;
    const lowStockHits = [];
    try {
      await session.withTransaction(async () => {
        const settings = await Settings.getSingleton();
        settingsSnapshot = settings;

        const orderLines = [];
        let subtotal = 0;

        for (const line of lines) {
          const slug = line.productId.toLowerCase();
          const updated = await Product.findOneAndUpdate(
            { slug, active: true, stock: { $gte: line.qty } },
            { $inc: { stock: -line.qty } },
            { new: true, session },
          );
          if (!updated) {
            const exists = await Product.findOne({ slug }).session(session);
            if (!exists || !exists.active) throw new AppError(`Product "${slug}" is not available`, 400);
            throw new AppError(`Not enough stock for ${exists.name} (only ${exists.stock} left)`, 409);
          }
          orderLines.push({ productId: updated.slug, name: updated.name, price: updated.price, qty: line.qty });
          subtotal += updated.price * line.qty;
          if (updated.stock <= settings.lowStockAt) lowStockHits.push({ name: updated.name, stock: updated.stock });
        }

        let discount = 0;
        let appliedPromoCode = null;
        if (promoCode) {
          const promo = await Promo.findOne({ code: promoCode.toUpperCase(), active: true }).session(session);
          if (!promo) throw new AppError("Invalid or expired promo code", 400);
          discount = Math.round(subtotal * (promo.percent / 100));
          appliedPromoCode = promo.code;
          promo.uses += 1;
          await promo.save({ session });
        }

        let delivery = settings.deliveryFee;
        if (settings.freeOver > 0 && subtotal >= settings.freeOver) delivery = 0;

        const total = subtotal - discount + delivery;
        const orderId = await nextOrderId(session);

        const created = await Order.create(
          [
            {
              orderId,
              user: req.user ? req.user._id : null,
              lines: orderLines,
              subtotal,
              discount,
              delivery,
              total,
              promoCode: appliedPromoCode,
              status: "placed",
              name,
              address,
              city,
              email: email.toLowerCase(),
              phone,
              payment,
            },
          ],
          { session },
        );
        order = created[0];
      });
    } finally {
      session.endSession();
    }

    const publicOrder = order.toPublic();
    // Awaited (not true fire-and-forget) so these finish before the
    // serverless function freezes post-response; every helper below
    // swallows its own errors, so a Pusher/Brevo outage never fails order
    // placement.
    const sideEffects = [notifyNewOrder(publicOrder), sendOrderConfirmation(publicOrder)];
    if (settingsSnapshot?.notifyOrders) sideEffects.push(sendAdminNewOrderAlert(publicOrder, settingsSnapshot.email));
    if (settingsSnapshot?.notifyLowStock && lowStockHits.length) sideEffects.push(sendAdminLowStockAlert(lowStockHits, settingsSnapshot.email));
    await Promise.all(sideEffects);

    res.status(201).json({ ok: true, order: publicOrder });
  }),
);

// GET /api/orders/mine — order history for the signed-in customer
router.get(
  "/mine",
  protect,
  asyncHandler(async (req, res) => {
    const orders = await Order.find({
      $or: [{ user: req.user._id }, { email: req.user.email }],
    }).sort({ createdAt: -1 });
    res.json({ ok: true, orders: orders.map((o) => o.toPublic()) });
  }),
);

// POST /api/orders/track — public order tracking by id + phone number
router.post(
  "/track",
  publicWriteLimiter,
  validateBody(z.object({ id: z.string().trim().min(1), phone: z.string().trim().min(1) })),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.body.id.trim().toUpperCase() });
    if (!order || digits(order.phone) !== digits(req.body.phone)) {
      throw new AppError("We couldn't find an order with that ID and phone number", 404);
    }
    res.json({ ok: true, order: order.toPublic() });
  }),
);

// GET /api/orders/:id — order detail for its owner (or an admin)
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.id.trim().toUpperCase() });
    if (!order) throw new AppError("Order not found", 404);

    const owns =
      (order.user && order.user.equals(req.user._id)) || order.email === req.user.email;
    if (!owns && req.user.role !== "admin") throw new AppError("Order not found", 404);

    res.json({ ok: true, order: order.toPublic() });
  }),
);

module.exports = router;
