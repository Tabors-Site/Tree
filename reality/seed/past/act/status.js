// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// updateActStatus — the only sanctioned post-seal write to an Act.
//
// Per CROSS-WORLD.md "Act lifecycle and status":
//
//   The Act itself is sealed and immutable. The `status` field is a
//   derived correlation between the Act and what the target's world
//   later reported. It transitions exactly once from "attempted" to a
//   terminal state; no other field on an Act ever mutates after seal.
//
// Terminal states (one-way):
//
//   attempted    initial — set by the Stamper at insert
//   landed       target side confirmed the consequence
//   denied       target side refused (auth / permissions / policy)
//   timeout      target side did not respond in the configured window
//   unreachable  canopy could not deliver (DNS / network down)
//   malformed    target side received but could not parse
//
// This helper enforces:
//   - the target state is in the terminal set
//   - the current state is "attempted" (monotonic transition)
//   - only one update ever lands per actId
//
// Callers:
//   - sealAct (4-stamped.js) moves attempted → landed inline for
//     same-substrate moments where the Stamper IS the target.
//   - The canopy response handler (when cross-reality lands) calls
//     this when a foreign substrate reports back.
//   - The pull-back safety job (when implemented) calls this with
//     timeout/unreachable for cross-world acts whose foreign side
//     never reported.

import Act from "./act.js";

const TERMINAL_STATES = new Set(["landed", "denied", "timeout", "unreachable", "malformed"]);

/**
 * Transition an Act's status from `attempted` to a terminal state.
 * Atomic: succeeds only if the current status is `attempted`. Returns
 * the updated Act row when the transition lands; returns null when
 * the Act was not in `attempted` (already terminal — idempotent
 * no-op) or the Act doesn't exist.
 *
 * @param {string} actId
 * @param {"landed"|"denied"|"timeout"|"unreachable"|"malformed"} status
 * @param {object} [meta]  optional diagnostic block written to
 *                         Act.qualities.statusMeta. Carries the
 *                         outcome details — denial reason, error
 *                         body, foreign actId, etc. Inspected by
 *                         clients rendering the act-chain. Should be
 *                         bounded; not redacted or hashed by this
 *                         helper.
 */
export async function updateActStatus(actId, status, meta = null) {
  if (typeof actId !== "string" || !actId.length) {
    throw new Error("updateActStatus: actId is required");
  }
  if (!TERMINAL_STATES.has(status)) {
    throw new Error(
      `updateActStatus: status must be one of ${[...TERMINAL_STATES].join("|")} (got "${status}")`
    );
  }
  const update = { $set: { status } };
  if (meta && typeof meta === "object") {
    update.$set["qualities.statusMeta"] = meta;
  }
  const result = await Act.findOneAndUpdate(
    { _id: String(actId), status: "attempted" },
    update,
    { returnDocument: "after" },
  );
  return result || null;
}
