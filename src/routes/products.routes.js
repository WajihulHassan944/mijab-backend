const express = require("express");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const router = express.Router();

// GET /api/products — active products only, for the storefront
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const products = await Product.find({ active: true }).sort({ createdAt: 1 });
    res.json({ ok: true, products: products.map((p) => p.toPublic()) });
  }),
);

// GET /api/products/:slug
router.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ slug: req.params.slug.toLowerCase(), active: true });
    if (!product) throw new AppError("Product not found", 404);
    res.json({ ok: true, product: product.toPublic() });
  }),
);

module.exports = router;
