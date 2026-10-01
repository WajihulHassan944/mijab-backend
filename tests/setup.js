const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_EXPIRES_IN = "1h";
process.env.NODE_ENV = "test";

let replset;

// If TEST_MONGODB_URI is set (e.g. a throwaway database on a real Atlas
// cluster), use it directly — much faster than spinning up an in-memory
// server, and avoids downloading the ~700MB mongod binary. Otherwise fall
// back to an in-memory single-node replica set (needed for transactions,
// which order placement relies on for atomic stock decrements).
beforeAll(async () => {
  if (process.env.TEST_MONGODB_URI) {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  } else {
    const { MongoMemoryReplSet } = require("mongodb-memory-server");
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    process.env.MONGODB_URI = replset.getUri("mijab_test");
  }

  // Connect up front: tests call Mongoose models directly (not just through
  // supertest/Express), which would otherwise race ahead of the app's lazy
  // per-request connectDB() and time out waiting on mongoose's query buffer.
  await mongoose.connect(process.env.MONGODB_URI);
}, 120000);

afterAll(async () => {
  if (process.env.TEST_MONGODB_URI) {
    // drop the throwaway test database so re-runs start clean, but leave
    // the cluster itself untouched
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
  if (replset) await replset.stop();
});
