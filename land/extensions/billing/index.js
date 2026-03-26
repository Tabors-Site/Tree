import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { createPurchaseSession } from "./purchase.js";
import { setEnergyService } from "./core/upgradePlan.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  const router = express.Router();

  router.post("/user/:userId/purchase", authenticate, createPurchaseSession);

  // Register Stripe webhook handler. The server exports registerWebhook()
  // for extensions that need raw-body routes mounted before express.json().
  let webhookHandler = null;
  try {
    const { stripeWebhook } = await import("./webhook.js");
    webhookHandler = stripeWebhook;
  } catch {}

  return {
    router,
    rawWebhook: webhookHandler, // loader mounts this at /billing/webhook with raw body
  };
}
