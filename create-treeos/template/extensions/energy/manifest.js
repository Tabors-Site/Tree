export default {
  name: "energy",
  version: "1.0.3",
  builtFor: "TreeOS",
  description:
    "Every action in TreeOS costs energy. Creating a node costs 3. Writing a note costs " +
    "1 to 5 depending on length. Changing a status costs 1. Running an understanding " +
    "pass, executing a script, completing a prestige version: each has a defined cost. " +
    "Energy prevents runaway usage, establishes fair limits across tiers, and gives land " +
    "operators a metering layer that works whether or not billing is installed. " +
    "\n\n" +
    "Each user has a daily energy budget that resets every 24 hours. The budget depends " +
    "on their tier: Basic gets 350, Standard gets 1,500, Premium gets 8,000. The reset " +
    "check runs lazily on profile load rather than on a cron schedule. If 24 hours have " +
    "passed since the last reset, energy refills to the tier limit. If the user's paid " +
    "plan has expired, they are automatically downgraded to Basic, their energy is reset " +
    "to the Basic limit, and all LLM slot assignments on their trees and user profile " +
    "are cleared. " +
    "\n\n" +
    "Energy deduction is atomic per action. The useEnergy function loads the user, checks " +
    "the daily reset, validates tier restrictions (Basic users cannot upload files, " +
    "Standard users have a 1 GB file size cap), calculates the cost, deducts from the " +
    "daily pool first and the additional (purchased) pool second, then saves. If total " +
    "available energy is below the cost, the action is rejected with an EnergyError. " +
    "File uploads that fail the check have their temporary files cleaned up immediately. " +
    "\n\n" +
    "Cost calculation has three tiers. Fixed-cost actions (create, delete, status change, " +
    "prestige, script execution) use a lookup table. Content actions (notes, raw ideas, " +
    "script edits) scale with text length at 1 energy per 1,000 characters, capped " +
    "between 1 and 5. File actions use a progressive rate: 1.5 energy per MB up to 100 " +
    "MB, 3 energy per MB from 100 MB to 1 GB, and quadratic scaling beyond 1 GB. " +
    "\n\n" +
    "The extension registers four lifecycle hooks for automatic metering: beforeNote, " +
    "beforeStatusChange, afterNodeCreate, and beforeNodeDelete. Other extensions that " +
    "need energy metering declare energy as an optional service and call core.energy " +
    "directly. Extensions can also register custom actions with registerAction, providing " +
    "a cost function that receives the payload and returns the energy cost. If energy is " +
    "not installed, core.energy is undefined and all metering is silently skipped.",

  needs: {
    services: ["hooks"],
    models: ["User", "Node"],
  },

  optional: {
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    sessionTypes: {},
    cli: [
      { command: "energy", scope: ["home"], description: "Show your energy balance and reset time", method: "GET", endpoint: "/user/:userId/energy" },
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
