const express = require("express");
const Settings = require("../models/Settings");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// GET /api/settings — the subset of store settings the storefront needs
// (delivery fee, free-delivery threshold, which payment methods are
// enabled). No auth: this is display config, not sensitive. Internal-only
// fields (notification toggles, low-stock threshold) stay on
// /api/admin/settings.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const s = await Settings.getSingleton();
    res.json({
      ok: true,
      settings: {
        storeName: s.storeName,
        deliveryFee: s.deliveryFee,
        freeOver: s.freeOver,
        cod: s.cod,
        card: s.card,
        bank: s.bank,
      },
    });
  }),
);

module.exports = router;
