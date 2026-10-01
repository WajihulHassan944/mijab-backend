const Counter = require("../models/Counter");

/**
 * Atomically reserves the next sequential order id, e.g. "MJB-10483".
 * Accepts an optional mongoose session so it can participate in a transaction.
 */
async function nextOrderId(session) {
  const counter = await Counter.findByIdAndUpdate(
    "orderId",
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session },
  );
  return `MJB-${counter.seq}`;
}

module.exports = nextOrderId;
