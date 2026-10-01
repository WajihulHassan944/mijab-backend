const express = require("express");
const { z } = require("zod");
const Message = require("../models/Message");
const Settings = require("../models/Settings");
const asyncHandler = require("../utils/asyncHandler");
const { validateBody } = require("../utils/validate");
const { publicWriteLimiter } = require("../middleware/rateLimit");
const { notifyNewMessage } = require("../utils/pusher");
const { sendAdminNewMessageAlert } = require("../utils/email");

const router = express.Router();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
});

// POST /api/contact — storefront contact form, lands in the admin inbox
router.post(
  "/",
  publicWriteLimiter,
  validateBody(contactSchema),
  asyncHandler(async (req, res) => {
    const message = await Message.create({ ...req.body, state: "unread" });
    const publicMessage = {
      id: message._id,
      name: message.name,
      email: message.email,
      subject: message.subject,
      body: message.body,
      createdAt: message.createdAt,
      state: message.state,
    };

    const sideEffects = [notifyNewMessage(publicMessage)];
    const settings = await Settings.getSingleton();
    if (settings.notifyMessages) sideEffects.push(sendAdminNewMessageAlert(publicMessage, settings.email));
    await Promise.all(sideEffects);

    res.status(201).json({ ok: true, id: message._id });
  }),
);

module.exports = router;
