const express = require("express");
const { z } = require("zod");
const Product = require("../../models/Product");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { validateBody } = require("../../utils/validate");
const { protect, adminOnly } = require("../../middleware/auth");

const router = express.Router();
router.use(protect, adminOnly);

const notesSchema = z.object({ top: z.string().optional(), heart: z.string().optional(), base: z.string().optional() }).optional();

const createSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(60),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(60).optional(),
  tagline: z.string().trim().max(160).optional(),
  blurb: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  price: z.number().min(0),
  compareAt: z.number().min(0).optional(),
  image: z.string().trim().max(300).optional(),
  swatch: z.string().trim().max(20).optional(),
  bag: z.string().trim().max(300).optional(),
  bagLabel: z.string().trim().max(120).optional(),
  bottle: z.string().trim().max(160).optional(),
  notes: notesSchema,
  stock: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.omit({ slug: true }).partial();

// GET /api/admin/products — every product, active or not
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const products = await Product.find().sort({ createdAt: 1 });
    res.json({ ok: true, products: products.map((p) => p.toPublic()) });
  }),
);

// POST /api/admin/products
router.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const product = await Product.create(req.body);
    res.status(201).json({ ok: true, product: product.toPublic() });
  }),
);

// PATCH /api/admin/products/:id (id = slug)
router.patch(
  "/:id",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const { notes, ...rest } = req.body;
    const update = { ...rest };
    // merge rather than replace, so patching just `notes.top` doesn't wipe heart/base
    if (notes) {
      for (const [k, v] of Object.entries(notes)) update[`notes.${k}`] = v;
    }
    const product = await Product.findOneAndUpdate({ slug: req.params.id.toLowerCase() }, update, {
      new: true,
      runValidators: true,
    });
    if (!product) throw new AppError("Product not found", 404);
    res.json({ ok: true, product: product.toPublic() });
  }),
);

// DELETE /api/admin/products/:id (id = slug)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await Product.findOneAndDelete({ slug: req.params.id.toLowerCase() });
    if (!product) throw new AppError("Product not found", 404);
    res.json({ ok: true });
  }),
);

module.exports = router;
