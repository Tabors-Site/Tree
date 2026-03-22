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
    models: {},
    routes: "../../routes/billing/purchase.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
