import express from "express";
import authenticate from "../../middleware/authenticate.js";
import { createPurchaseSession } from "../../routes/billing/purchase.js";

export async function init(core) {
  const router = express.Router();

  // Purchase checkout session
  router.post("/user/:userId/purchase", authenticate, createPurchaseSession);

  // Note: The Stripe webhook route stays in server.js because it needs
  // express.raw() body parsing registered before express.json().

  return { router };
}
