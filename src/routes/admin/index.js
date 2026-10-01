const express = require("express");

const router = express.Router();

router.use("/auth", require("./auth.routes"));
router.use("/orders", require("./orders.routes"));
router.use("/products", require("./products.routes"));
router.use("/promos", require("./promos.routes"));
router.use("/messages", require("./messages.routes"));
router.use("/customers", require("./customers.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/analytics", require("./analytics.routes"));

module.exports = router;
