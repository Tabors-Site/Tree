const express = require("express");
const { getTransactions, tradeValues } = require("../controllers/transactions");
const authenticate = require("../middleware/authenticate");
const router = express.Router();

router.get("/get-transactions", getTransactions);

router.post("/trade-values", authenticate, tradeValues);

module.exports = router;
