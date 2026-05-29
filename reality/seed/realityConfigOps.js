// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// realityConfigOps.js — DO operations for the place config store.
//
// Place config lives in the `.config` seed space's qualities Map,
// one key per Map entry. Reads route through `ibp:see` on
// `<reality>/.config` (returns the cached snapshot); writes route
// through these two ops which wrap setRealityConfigValue /
// deleteRealityConfigValue. The wrappers handle cache invalidation,
// validation, and the PROTECTED_KEYS gate (seedVersion and
// disabledExtensions can only be written from scaffold flows).
//
// `skipAudit: true` because the underlying helpers route their
// writes through `do.set-space` on the .config space and the inner
// set IS the canonical audit Fact.
//
// These self-register at module load. `seed/services.js` imports
// this file for side effects; the registry is populated before any
// caller dispatches.

import { registerOperation } from "./ibp/operations.js";

registerOperation("set-config", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: async ({ params, scaffold, identity }) => {
    const { key, value } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("set-config: `key` is required");
    }
    if (value === undefined) {
      throw new Error(
        "set-config: `value` is required (use delete-config to remove)",
      );
    }
    // Scaffold flows (migrations, first-boot bootstrap) are permitted
    // to write PROTECTED_KEYS (seedVersion, disabledExtensions). Being
    // calls never carry scaffold and stay subject to the protected-key
    // gate in realityConfig.js.
    const { setRealityConfigValue } = await import("./realityConfig.js");
    await setRealityConfigValue(key, value, {
      internal: scaffold === true,
      identity,
    });
    return { key, value };
  },
});

registerOperation("delete-config", {
  targets: ["space"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: async ({ params, scaffold, identity }) => {
    const { key } = params || {};
    if (!key || typeof key !== "string") {
      throw new Error("delete-config: `key` is required");
    }
    const { deleteRealityConfigValue } = await import("./realityConfig.js");
    await deleteRealityConfigValue(key, {
      internal: scaffold === true,
      identity,
    });
    return { deleted: true, key };
  },
});
