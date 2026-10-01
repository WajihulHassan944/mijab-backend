const express = require("express");
const { z } = require("zod");
const Message = require("../../models/Message");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");
const { sendMessageReply } = require("../../utils/email");

const router = express.Router();
router.use(protect, adminOnly);

// GET /api/admin/messages
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const messages = await Message.find().sort({ createdAt: -1 });
    res.json({ ok: true, messages });
  }),
);

// PATCH /api/admin/messages/:id — mark read/unread/replied, optionally attach a reply
router.patch(
  "/:id",
  validateBody(
    z.object({
      state: z.enum(["unread", "read", "replied"]).optional(),
      reply: z.string().max(4000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await Message.findById(req.params.id);
    if (!existing) throw new AppError("Message not found", 404);

    // email only when this request is the one supplying a reply for the first time
    const isNewReply = typeof req.body.reply === "string" && req.body.reply.trim() && req.body.reply !== existing.reply;

    const message = await Message.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (isNewReply) await sendMessageReply(message);
    res.json({ ok: true, message });
  }),
);

// DELETE /api/admin/messages/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const message = await Message.findByIdAndDelete(req.params.id);
    if (!message) throw new AppError("Message not found", 404);
    res.json({ ok: true });
  }),
);

module.exports = router;
