const mongoose = require("mongoose");

// Customer reviews. Submitted from the storefront once an order is delivered,
// and only shown publicly (homepage) after an admin approves them.
const reviewSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true }, // one review per order
    name: { type: String, required: true, trim: true },
    city: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    products: { type: [String], default: [] }, // product names from the order, for context
    rating: { type: Number, required: true, min: 1, max: 5 },
    body: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  },
  { timestamps: true },
);

reviewSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    city: this.city,
    products: this.products,
    rating: this.rating,
    body: this.body,
    createdAt: this.createdAt,
  };
};

reviewSchema.methods.toAdmin = function toAdmin() {
  return { ...this.toPublic(), orderId: this.orderId, email: this.email, status: this.status, updatedAt: this.updatedAt };
};

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
