const mongoose = require("mongoose");

/**
 * Serverless functions can be invoked many times against a warm container,
 * so we cache the connection (and the in-flight connect promise) on the
 * global object to avoid exhausting Atlas connections.
 */
let cached = global._mijabMongoose;
if (!cached) {
  cached = global._mijabMongoose = { conn: null, promise: null };
}

// Mongoose connection readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting.
const READY = 1;

async function connectDB() {
  // A warm serverless container can hold a cached connection that Atlas has
  // since dropped (idle timeout, network blip). Trusting cached.conn without
  // checking readyState left every query silently stuck in Mongoose's
  // command buffer until it timed out — this is what was failing in
  // production. Treat anything but a live, connected state as stale.
  if (cached.conn && mongoose.connection.readyState === READY) return cached.conn;
  if (cached.conn && mongoose.connection.readyState !== READY) {
    cached.conn = null;
    cached.promise = null;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to your environment variables.");
  }

  if (!cached.promise) {
    mongoose.set("strictQuery", true);
    cached.promise = mongoose
      .connect(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
      })
      .then((mongooseInstance) => mongooseInstance);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

module.exports = connectDB;
