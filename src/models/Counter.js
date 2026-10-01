const mongoose = require("mongoose");

/**
 * Generic auto-increment counter, used to mint human-friendly, sequential
 * order IDs (MJB-10483, MJB-10484, ...) without relying on Mongo ObjectIds.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 10482 },
});

module.exports = mongoose.models.Counter || mongoose.model("Counter", counterSchema);
