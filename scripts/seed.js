/**
 * One-time setup script: creates the admin account, the three MIJAB products,
 * starter promo codes and the default settings document.
 * Safe to re-run — existing records are left untouched.
 *
 * Usage: npm run seed
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/db");
const User = require("../src/models/User");
const Product = require("../src/models/Product");
const Promo = require("../src/models/Promo");
const Settings = require("../src/models/Settings");
const Counter = require("../src/models/Counter");

const PRODUCTS = [
  {
    slug: "cafe-noir",
    sku: "MJB-CN-50",
    name: "Café Noir",
    audience: "For Him",
    tagline: "Bold / Classic / Timeless",
    blurb: "Roasted coffee, leather and dark amber.",
    description:
      "A deep, dark fragrance built around freshly roasted coffee, warmed by leather and softened with tonka bean. Made for evenings that run long.",
    price: 2500,
    image: "/images/cafe-noir.jpg",
    swatch: "#141010",
    bag: "/images/bag-black.png",
    bagLabel: "Black MIJAB bag",
    bottle: "Black glass with blue accents",
    notes: { top: "Bergamot, Cardamom", heart: "Roasted Coffee, Leather", base: "Tonka Bean, Dark Amber" },
    stock: 64,
    active: true,
  },
  {
    slug: "vanilla-gourmand",
    sku: "MJB-VG-50",
    name: "Vanilla Gourmand",
    audience: "For Her",
    tagline: "Soft / Elegant / Unforgettable",
    blurb: "Vanilla orchid, praline and sandalwood.",
    description:
      "A warm, indulgent fragrance of vanilla orchid and praline, lifted by pear and a touch of pink pepper. Soft, lingering and unforgettable.",
    price: 2500,
    image: "/images/vanilla-gourmand.jpg",
    swatch: "#DCCBE6",
    bag: "/images/bag-pink.png",
    bagLabel: "Pink MIJAB bag",
    bottle: "Black glass with purple accents",
    notes: { top: "Pear, Pink Pepper", heart: "Vanilla Orchid, Praline", base: "Tonka Bean, Sandalwood" },
    stock: 8,
    active: true,
  },
  {
    slug: "duo",
    sku: "MJB-DUO-100",
    name: "The Duo",
    audience: "Both fragrances",
    tagline: "Two fragrances. One story.",
    blurb: "Café Noir and Vanilla Gourmand, together.",
    description: "Gift him, gift her, or keep both. The pair arrives together in a signature MIJAB bag.",
    price: 4500,
    compareAt: 5000,
    image: "/images/duo.jpg",
    swatch: "#141010",
    notes: {
      top: "Bergamot, Cardamom · Pear, Pink Pepper",
      heart: "Roasted Coffee, Leather · Vanilla Orchid, Praline",
      base: "Tonka Bean · Sandalwood",
    },
    stock: 31,
    active: true,
  },
];

const PROMOS = [
  { code: "WELCOME10", percent: 10, active: true, note: "First order welcome offer" },
  { code: "MIJAB10", percent: 10, active: true, note: "Instagram giveaway" },
  { code: "EID20", percent: 20, active: false, note: "Eid campaign (ended)" },
];

async function run() {
  await connectDB();
  console.log("Connected to MongoDB.");

  // Admin account
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@mijab.com").toLowerCase();
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: process.env.ADMIN_NAME || "MIJAB Admin",
      email: adminEmail,
      password: process.env.ADMIN_PASSWORD || "admin123",
      role: "admin",
    });
    console.log(`Created admin account: ${adminEmail}`);
  } else {
    console.log(`Admin account already exists: ${adminEmail}`);
  }

  // Products
  for (const p of PRODUCTS) {
    const existing = await Product.findOne({ slug: p.slug });
    if (existing) {
      console.log(`Product already exists, skipping: ${p.slug}`);
      continue;
    }
    await Product.create(p);
    console.log(`Created product: ${p.slug}`);
  }

  // Promo codes
  for (const promo of PROMOS) {
    const existing = await Promo.findOne({ code: promo.code });
    if (existing) {
      console.log(`Promo already exists, skipping: ${promo.code}`);
      continue;
    }
    await Promo.create(promo);
    console.log(`Created promo: ${promo.code}`);
  }

  // Settings singleton
  await Settings.getSingleton();
  console.log("Settings ready.");

  // Order id counter (so the first real order is MJB-10483, matching the original mock)
  await Counter.findByIdAndUpdate("orderId", { $setOnInsert: { seq: 10482 } }, { upsert: true });
  console.log("Order id counter ready.");

  console.log("Seed complete.");
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
