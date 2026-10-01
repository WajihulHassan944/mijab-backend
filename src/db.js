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

async function connectDB() {
  if (cached.conn) return cached.conn;

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
