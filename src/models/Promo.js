const mongoose = require("mongoose");

const promoSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    percent: { type: Number, required: true, min: 1, max: 100 },
    active: { type: Boolean, default: true },
    uses: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Promo || mongoose.model("Promo", promoSchema);
