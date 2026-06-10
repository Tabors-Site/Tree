// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// public-commons/role.js — a TEMPLATE role for "anyone can visit my
// public-owned space and do basic things."
//
// NOT a seed-special role. As of the acquisition-policy refactor
// (seed/RolesAreAuth.md "Acquisition"), there's no hardcoded
// "public-commons floor" in roleAuth.js anymore. @public is just a
// regular being who happens to own spaces; the role-walk authorize
// treats their spaces uniformly with everyone else's.
//
// What makes "@public's space" feel different in practice is the
// `acquisition.autoOnEntry: true` flag on this role — visitors who
// SEE the space get auto-granted the role silently. The role-walk
// then admits them via their normal qualities.rolesGranted entry,
// not via any branch in the auth code.
//
// Usage: operators (including @public itself) install this on their
// owned spaces via `set-role` or `installRoleOnSpace`, OR they
// author a different visitor role with the shape they want. The
// commons surface is whatever the operator declares — this file is
// just a sensible default for "open commons with read + move +
// stake-claim + summon-the-gate."

export const publicCommonsRole = Object.freeze({
  name: "public-commons",
  description:
    "Visitor role for an open commons. Auto-granted on first SEE " +
    "via acquisition.autoOnEntry. Permits read + move + place matter " +
    "+ stake new sub-spaces + summon @cherub.",
  requiredCognition: null,
  respondMode: "async",
  triggerOn: [],
  acquisition: {
    asked:       "auto",   // ask-role grants immediately
    grabbed:     false,    // no take-role; SEE is the entry point
    autoOnEntry: true,     // silent grant on first SEE of a space hosting this role
  },
  canSee:    ["*"],
  canDo: [
    { action: "move",                description: "move in space" },
    { action: "set-being:coord",     description: "update your coord" },
    { action: "set-being:position",  description: "walk to another space" },
    { action: "create-space",        description: "stake a new sub-space here" },
    { action: "create-matter",       description: "place matter here" },
  ],
  canSummon: [
    { pattern: "@cherub", description: "address the gate" },
  ],
  canBe: [
    { operation: "release", description: "log out" },
  ],
});
