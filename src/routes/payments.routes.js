const express = require("express");
const { z } = require("zod");
const Order = require("../models/Order");
const Product = require("../models/Product");
const safepay = require("../utils/safepay");
const { notifyOrderUpdate } = require("../utils/pusher");
const { sendOrderConfirmation } = require("../utils/email");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { validateBody } = require("../utils/validate");
const { publicWriteLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// POST /api/payments/safepay/checkout — starts a Safepay hosted-checkout
// session for an order that was placed with payment: "Debit or credit card",
// and returns the URL to redirect the customer to. No auth: the frontend
// calls this immediately after /api/orders returns, using the id it just
// got back. This can only ever *start* a payment attempt — an order is only
// ever marked paid by the signed webhook below, never by this endpoint.
router.post(
  "/safepay/checkout",
  publicWriteLimiter,
  validateBody(z.object({ orderId: z.string().trim().min(1) })),
  asyncHandler(async (req, res) => {
    if (!safepay.isConfigured()) throw new AppError("Online card payment isn't configured yet", 503);

    const order = await Order.findOne({ orderId: req.body.orderId.trim().toUpperCase() });
    if (!order) throw new AppError("Order not found", 404);
    if (order.paymentStatus !== "pending") throw new AppError("This order isn't awaiting card payment", 400);

    const base = process.env.FRONTEND_URL || "";
    const { tracker, checkoutUrl } = await safepay.createCheckout({
      amount: order.total,
      orderId: order.orderId,
      redirectUrl: `${base}/confirmation?order=${order.orderId}`,
      cancelUrl: `${base}/checkout?payment=cancelled&order=${order.orderId}`,
    });

    order.safepayTracker = tracker;
    await order.save();

    res.json({ ok: true, checkoutUrl });
  }),
);

// POST /api/payments/safepay/webhook — Safepay's async, signed notification
// of a payment's outcome. Configure this URL in the Safepay dashboard
// (Developers -> Webhooks). This is the ONLY thing allowed to mark an order
// paid — the browser redirect back from checkout is not trusted for that.
router.post(
  "/safepay/webhook",
  asyncHandler(async (req, res) => {
    const signature = req.headers["x-sfpy-signature"];
    if (!safepay.verifyWebhookSignature(req.body, signature)) {
      throw new AppError("Invalid webhook signature", 401);
    }

    const { type, data } = req.body || {};
    const orderId = data?.metadata?.order_id;
    if (!orderId) return res.json({ ok: true }); // nothing to match against; ack anyway

    const order = await Order.findOne({ orderId });
    if (!order || order.paymentStatus !== "pending") return res.json({ ok: true });

    if (type === "payment.succeeded") {
      order.paymentStatus = "paid";
      await order.save();
      const publicOrder = order.toPublic();
      await Promise.all([sendOrderConfirmation(publicOrder), notifyOrderUpdate(publicOrder)]);
    } else if (type === "payment.failed") {
      order.paymentStatus = "failed";
      order.status = "cancelled";
      await order.save();
      // the customer never actually paid, so release the stock their
      // abandoned/declined order was holding
      await Promise.all(order.lines.map((l) => Product.updateOne({ slug: l.productId }, { $inc: { stock: l.qty } })));
      await notifyOrderUpdate(order.toPublic());
    }

    res.json({ ok: true });
  }),
);

module.exports = router;
