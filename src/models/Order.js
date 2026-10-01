const mongoose = require("mongoose");

const STATUS_FLOW = ["placed", "packed", "out", "delivered"];

const lineSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true }, // product slug, kept even if the product is later removed
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 }, // unit price at time of purchase
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true }, // e.g. MJB-10483
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    lines: { type: [lineSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },

    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    delivery: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    promoCode: { type: String, default: null },

    status: {
      type: String,
      enum: ["placed", "packed", "out", "delivered", "cancelled"],
      default: "placed",
      index: true,
    },
    stage: { type: Number, min: 0, max: 3, default: 0 },

    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true },
    payment: { type: String, required: true, trim: true },

    note: { type: String, default: "" }, // internal admin note
  },
  { timestamps: true },
);

orderSchema.pre("validate", function setStage(next) {
  if (this.status === "cancelled") {
    this.stage = this.stage ?? 0;
  } else {
    const idx = STATUS_FLOW.indexOf(this.status);
    this.stage = idx === -1 ? 0 : idx;
  }
  next();
});

orderSchema.methods.toPublic = function toPublic() {
  return {
    id: this.orderId,
    placedOn: this.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    createdAt: this.createdAt,
    stage: this.stage,
    status: this.status,
    lines: this.lines.map((l) => ({ id: l.productId, qty: l.qty, name: l.name, price: l.price })),
    subtotal: this.subtotal,
    discount: this.discount,
    delivery: this.delivery,
    total: this.total,
    promoCode: this.promoCode,
    name: this.name,
    address: this.address,
    city: this.city,
    email: this.email,
    phone: this.phone,
    payment: this.payment,
  };
};

orderSchema.statics.STATUS_FLOW = STATUS_FLOW;

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
