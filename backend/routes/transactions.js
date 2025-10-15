import express from 'express';
import { getTransactions, tradeValues } from '../controllers/transactions.js';
import authenticate from '../middleware/authenticate.js';
const router = express.Router();

router.get("/get-transactions", getTransactions);

router.post("/trade-values", authenticate, tradeValues);

export default router;
