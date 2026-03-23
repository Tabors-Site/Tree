import express from "express";
import authenticate from "../../middleware/authenticate.js";
import { createPurchaseSession } from "./purchase.js";
import { setEnergyService } from "./core/upgradePlan.js";

export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
  const router = express.Router();

  router.post("/user/:userId/purchase", authenticate, createPurchaseSession);

  return { router };
}
