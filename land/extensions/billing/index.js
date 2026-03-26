import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { createPurchaseSession } from "./purchase.js";
import { setEnergyService } from "./core/upgradePlan.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  const router = express.Router();

  router.post("/user/:userId/purchase", authenticate, createPurchaseSession);

  // Stripe webhook handler. Lazy-load webhook.js (and the Stripe SDK)
  // on first request to avoid blocking boot if the SDK init is slow.
  let _webhookMod = null;
  const webhookHandler = async (req, res) => {
    if (!_webhookMod) _webhookMod = await import("./webhook.js");
    return _webhookMod.stripeWebhook(req, res);
  };

  return {
    router,
    rawWebhook: webhookHandler, // loader mounts this at /billing/webhook with raw body
  };
}
