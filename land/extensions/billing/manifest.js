export default {
  name: "billing",
  version: "1.0.0",
  description: "Stripe subscription tiers and energy purchases",

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
