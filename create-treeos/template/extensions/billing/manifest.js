export default {
  name: "billing",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Monetization for a TreeOS land. This extension connects Stripe Checkout to the " +
    "tier and energy systems so land operators can charge for access. Two subscription " +
    "tiers are available: Standard ($20/month) and Premium ($100/month). Each tier sets " +
    "a higher daily energy budget through the energy extension. Users can also purchase " +
    "additional energy units as a one-time top-up alongside or independent of a plan " +
    "upgrade. A single checkout session can combine a plan change and an energy boost. " +
    "\n\n" +
    "The purchase flow creates a Stripe Checkout session with the plan and energy amounts " +
    "encoded in session metadata. On successful payment, Stripe fires a webhook. The " +
    "webhook handler verifies the signature, logs a contribution to the kernel audit " +
    "trail with full Stripe references (session ID, payment intent, event ID, currency, " +
    "total), then calls processPurchase to apply the changes. Duplicate webhook deliveries " +
    "are caught by the contribution model's unique constraint and silently ignored. " +
    "\n\n" +
    "Plan upgrades are prorated. If a user upgrades from Standard to Premium mid-cycle, " +
    "the remaining days on the old plan are converted to bonus energy and added to their " +
    "additional energy pool. The new plan's expiration extends from whichever is later: " +
    "now or the old expiration date. Downgrades are blocked at the validation layer. " +
    "When a plan expires, the energy extension's daily reset detects it and reverts the " +
    "user to Basic tier, clearing all LLM slot assignments in the process. " +
    "\n\n" +
    "Validation runs before the Stripe session is created. Invalid plans, negative energy " +
    "amounts, and amounts above the safety cap of one million units are rejected before " +
    "the user ever sees a payment form. The webhook handler is lazy-loaded on first " +
    "request to avoid blocking boot with Stripe SDK initialization.",

  npm: ["stripe@^20.3.1"],

  needs: {
    models: ["User"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    env: [
      { key: "STRIPE_SECRET_KEY", required: true, secret: true, description: "Stripe secret key for payment processing" },
      { key: "STRIPE_WEBHOOK_SECRET", required: true, secret: true, description: "Stripe webhook signing secret" },
    ],
    models: {},
    routes: "./purchase.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
