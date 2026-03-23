export default {
  name: "energy",
  version: "2.0.0",
  description: "Daily energy budget with tier-based limits. Registers lifecycle hooks for automatic metering. Other extensions use core.energy if available.",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    routes: "./routes.js",
    cli: [
      { command: "energy", description: "Show your energy balance and reset time", method: "GET", endpoint: "/user/:userId/energy" },
    ],

    hooks: {
      fires: [],
      listens: ["beforeNote", "beforeStatusChange", "afterNodeCreate", "beforeNodeDelete"],
    },

    // Documented exports (available via core.energy or getExtension("energy")?.exports)
    //
    // core.energy.useEnergy({ userId, action })  - Deduct energy for an action. Throws EnergyError if insufficient.
    // core.energy.maybeResetEnergy(user)          - Reset daily energy if 24h have passed. Called on user profile load.
    // core.energy.DAILY_LIMITS                    - { basic: 350, standard: 1500, premium: 8000, god: 10000000000 }
    //
    // Extensions that want energy metering declare: optional: { services: ["energy"] }
    // Then in init(core): if (core.energy) setEnergyService(core.energy);
    // If energy is not installed, core.energy is undefined and all checks safely skip.
  },
};
