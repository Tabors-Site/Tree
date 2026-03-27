export default {
  name: "user-tiers",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The access control layer between users and features. Every user has a tier stored " +
    "in metadata.tiers.plan (defaults to 'basic' if unset). Extensions declare which " +
    "tiers unlock their features by calling registerFeature(featureName, allowedTiers) " +
    "during init. The hasAccess(userId, feature) export checks the user's current tier " +
    "against the registered tier list for that feature. Unknown features return true " +
    "(permissive default: if nobody registered the feature, nobody restricted it).\n\n" +
    "Built-in feature gates: auto-place requires standard or premium, file-upload " +
    "requires standard or premium. Other extensions add their own gates at boot. The " +
    "billing extension calls setUserTier when a subscription changes. Admin users can " +
    "set any user's tier via PUT /user/:userId/tier. The CLI exposes 'tier' to check " +
    "your current plan. No models of its own. Tier data lives in user metadata. The " +
    "exports (getUserTier, hasAccess, setUserTier, registerFeature) are the contract " +
    "other extensions depend on. Energy reads the tier for daily limits. Billing " +
    "writes the tier on payment. Everything else checks access through hasAccess.",

  needs: {
    models: ["User"],
    services: ["protocol"],
  },

  optional: {},

  provides: {
    routes: "./routes.js",
    tools: false,
    modes: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "tier", description: "Show your current tier", method: "GET", endpoint: "/user/:userId/tier" },
    ],
  },
};
