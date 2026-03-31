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

  // Register payment UI on the energy page
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("energy-payment", "billing", ({ userId, plan, planExpiresAt }) => {
      return `
  <!-- Plans -->
  <div class="glass-card" style="animation-delay: 0.15s;">
    <h2>\uD83D\uDCCB Plans</h2>
    <div class="plan-grid">
      <div class="plan-box disabled" data-plan="basic">
        <div class="plan-name">Basic</div>
        <div class="plan-price">Free</div>
        <div class="plan-period">350 daily energy</div>
        <div class="plan-features">
          <div class="plan-feature">No file uploads</div>
          <div class="plan-feature dim">Limited access</div>
        </div>
        ${plan === "basic" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="standard">
        <div class="plan-name">Standard</div>
        <div class="plan-price">$20</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">1,500 daily energy</div>
          <div class="plan-feature">File uploads</div>
        </div>
        ${plan === "standard" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="premium">
        <div class="plan-name">Premium</div>
        <div class="plan-price">$100</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">8,000 daily energy</div>
          <div class="plan-feature">Full access</div>
          <div class="plan-feature highlight">Offline LLM processing</div>
        </div>
        ${plan === "premium" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
    </div>
    <div class="plan-renew-note" id="planNote" style="display:none;"></div>
  </div>

  <!-- Buy Energy -->
  <div class="glass-card" style="animation-delay: 0.2s;">
    <h2>\uD83D\uDD25 Additional Energy</h2>
    <div style="font-size: 14px; color: rgba(255,255,255,0.55); margin-bottom: 16px;">Reserve energy \u2014 only used when your plan energy runs out.</div>
    <div class="energy-btns" id="energyBtns">
      <button class="energy-buy-btn" data-amount="100">+100</button>
      <button class="energy-buy-btn" data-amount="500">+500</button>
      <button class="energy-buy-btn" data-amount="1000">+1000</button>
      <button class="energy-buy-btn" id="customEnergyBtn">+Custom</button>
    </div>
    <div id="energyAdded" style="margin-top: 14px; font-size: 14px; color: rgba(255,255,255,0.6); display: none;">
      Added: <strong id="energyAddedVal" style="color: white;"></strong>
      <span style="margin-left: 8px; cursor: pointer; opacity: 0.6;" onclick="resetEnergy()">\u2715 Clear</span>
    </div>
  </div>

  <!-- Checkout -->
  <div class="glass-card" style="animation-delay: 0.25s;">
    <h2>\uD83D\uDCB3 Checkout</h2>
    <div id="checkoutContent">
      <div class="checkout-empty">Select a plan or add energy to continue</div>
    </div>
  </div>`;
    }, { priority: 10 });
  } catch {}

  return {
    router,
    rawWebhook: webhookHandler,
  };
}
