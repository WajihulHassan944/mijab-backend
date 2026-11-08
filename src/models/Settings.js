const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    // singleton document; key is always "default"
    key: { type: String, default: "default", unique: true },
    storeName: { type: String, default: "MIJAB" },
    email: { type: String, default: "mjb_essence@outlook.com" },
    phone: { type: String, default: "0300 0000000" },
    deliveryFee: { type: Number, default: 350, min: 0 },
    freeOver: { type: Number, default: 0, min: 0 },
    cod: { type: Boolean, default: true },
    card: { type: Boolean, default: true },
    bank: { type: Boolean, default: true },
    notifyOrders: { type: Boolean, default: true },
    notifyLowStock: { type: Boolean, default: true },
    notifyMessages: { type: Boolean, default: false },
    lowStockAt: { type: Number, default: 10, min: 0 },
    // Store pickup: customer collects the order themselves, no delivery fee.
    pickup: { type: Boolean, default: true },
    pickupAddress: { type: String, default: "", trim: true }, // where/when to collect; shown at checkout and in emails
  },
  { timestamps: true },
);

settingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: "default" });
  if (!doc) doc = await this.create({ key: "default" });
  return doc;
};

module.exports = mongoose.models.Settings || mongoose.model("Settings", settingsSchema);
