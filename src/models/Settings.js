const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    // singleton document; key is always "default"
    key: { type: String, default: "default", unique: true },
    storeName: { type: String, default: "MIJAB" },
    email: { type: String, default: "hello@mijab.com" },
    phone: { type: String, default: "0300 0000000" },
    deliveryFee: { type: Number, default: 200, min: 0 },
    freeOver: { type: Number, default: 0, min: 0 },
    cod: { type: Boolean, default: true },
    card: { type: Boolean, default: true },
    bank: { type: Boolean, default: true },
    notifyOrders: { type: Boolean, default: true },
    notifyLowStock: { type: Boolean, default: true },
    notifyMessages: { type: Boolean, default: false },
    lowStockAt: { type: Number, default: 10, min: 0 },
  },
  { timestamps: true },
);

settingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: "default" });
  if (!doc) doc = await this.create({ key: "default" });
  return doc;
};

module.exports = mongoose.models.Settings || mongoose.model("Settings", settingsSchema);
