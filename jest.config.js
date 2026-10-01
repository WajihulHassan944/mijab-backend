module.exports = {
  testEnvironment: "node",
  testTimeout: 120000, // the first run downloads a MongoDB binary (one-time, can take a while)
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
};
