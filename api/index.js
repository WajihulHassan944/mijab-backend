require("dotenv").config();
const app = require("../src/app");

// Vercel invokes this default export as handler(req, res); an Express app
// is already a (req, res, next) function, so we can export it directly.
module.exports = app;
