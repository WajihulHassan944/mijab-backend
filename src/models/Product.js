const mongoose = require("mongoose");

const notesSchema = new mongoose.Schema(
  {
    top: { type: String, default: "" },
    heart: { type: String, default: "" },
    base: { type: String, default: "" },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    audience: { type: String, default: "" },
    tagline: { type: String, default: "" },
    blurb: { type: String, default: "" },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    compareAt: { type: Number, min: 0 },
    image: { type: String, default: "" },
    swatch: { type: String, default: "#141010" },
    bag: { type: String, default: "" },
    bagLabel: { type: String, default: "" },
    bottle: { type: String, default: "" },
    notes: { type: notesSchema, default: () => ({}) },
    stock: { type: Number, required: true, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.methods.toPublic = function toPublic() {
  return {
    id: this.slug,
    slug: this.slug,
    sku: this.sku,
    name: this.name,
    audience: this.audience,
    tagline: this.tagline,
    blurb: this.blurb,
    description: this.description,
    price: this.price,
    compareAt: this.compareAt,
    image: this.image,
    swatch: this.swatch,
    bag: this.bag,
    bagLabel: this.bagLabel,
    bottle: this.bottle,
    notes: this.notes,
    stock: this.stock,
    active: this.active,
  };
};

module.exports = mongoose.models.Product || mongoose.model("Product", productSchema);
