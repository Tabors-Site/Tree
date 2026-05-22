// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// assign.js — beat one of the stamping. Who acts.
//
// Scheduler picks an inbox entry off a being's line and hands it
// here. assign loads the receiver Being, resolves the active role,
// checks role-carry, and builds the summon context the role's voice
// expects. It returns { role, summonCtx } for moment to dispatch, or
// { skipped } when the entry can't run.
//
// assign does NOT reserve the Stamp row. The row write needs voice-
// specific provenance (the LLM voice writes its provider model +
// connection into the row), and assign doesn't know which voice
// will run momentum. The voice itself calls
// [beginStamping](./begin.js) when it has its provider info in hand.
// Architecturally beat-1 is two cooperating files: assign decides
// who acts, begin reserves the row when the voice opens it.
//
// The four beats of a stamping:
//   assign.js   who acts                  (this file)
//   begin.js    reserve the row           (called by voices)
//   fold/       read the present
//   moment.js   the being acting
//   stamped.js  press the closing face
//
// Voice apparatus lives outside the stamper. The LLM voice subsystem
// (runTurn + assemble + compress + provider call + tools registry) is
// in [voices/llm/](../voices/llm/); scripted roles carry their own
// summon code; role templates and the role registry live in
// [roles/](../roles/). assign just resolves the role spec — what the
// role IS (prompt, tools, summon handler) lives with the voice it
// belongs to.

import log from "../../system/log.js";
import Being from "../../models/being.js";
import { getRole } from "../roles/registry.js";

/**
 * Set up one moment for stamping. Returns the prepared role + ctx
 * for moment() to dispatch, or { skipped } when the entry can't run.
 *
 * @param {object} opts
 * @param {string} opts.beingId       — receiver
 * @param {string} opts.spaceId       — inbox position the entry landed at
 * @param {object} opts.entry         — the inbox row (correlation, content, activeRole, ...)
 * @param {object} [opts.handoff]     — runtime context stashed by SUMMON (identity, resolved, ...)
 * @param {AbortSignal} [opts.signal] — abort propagating from the scheduler's controller
 *
 * @returns {Promise<{ role?, summonCtx?, skipped? }>}
 *   role       — resolved role spec
 *   summonCtx  — the prepared context the role's summon handler expects
 *   skipped    — reason string when the entry can't run
 *                ("being-not-found" | "role-not-carried" | "role-unavailable")
 */
export async function assign({ beingId, spaceId, entry, handoff = null, signal = null } = {}) {
  // ── assign: load the being ───────────────────────────────────────
  const toBeing = await Being.findById(beingId);
  if (!toBeing) {
    log.warn("Assign", `being ${String(beingId).slice(0, 8)} not found`);
    return { skipped: "being-not-found" };
  }

  // ── assign: resolve the active role ──────────────────────────────
  // entry.activeRole has primacy when present; toBeing.defaultRole
  // falls back when the inbox row didn't pin one. A specified
  // activeRole must be in the being's roles[].
  let activeRole = null;
  if (entry.activeRole) {
    const carried = Array.isArray(toBeing.roles) ? toBeing.roles : [];
    if (!carried.includes(entry.activeRole)) {
      log.warn(
        "Assign",
        `entry's activeRole "${entry.activeRole}" not carried by being ` +
          `${String(beingId).slice(0, 8)} (roles: ${carried.join(", ") || "none"})`,
      );
      return { skipped: "role-not-carried" };
    }
    activeRole = entry.activeRole;
  } else {
    activeRole = toBeing.defaultRole || null;
  }

  const role = activeRole ? getRole(activeRole) : null;
  if (!role) {
    log.warn(
      "Assign",
      `no role registered for "${activeRole}" of being ${String(beingId).slice(0, 8)}`,
    );
    return { skipped: "role-unavailable" };
  }

  // ── assign: build the summon ctx the role expects ────────────────
  // Mirrors verbs/summon.js's same-shape build at request time. The
  // handoff record (registered by the SUMMON verb when respondMode is
  // "async") carries the asker's identity and the resolved stance.
  const summonCtx = {
    spaceId,
    being:       activeRole,             // legacy field name; carries the active role
    activeRole,
    toBeing,
    message: {
      from:            entry.from,
      content:         entry.content,
      correlation:     entry.correlation,
      rootCorrelation: entry.rootCorrelation || entry.correlation,
      activeRole,
      inReplyTo:       entry.inReplyTo,
      attachments:     entry.attachments,
      sentAt:          entry.sentAt,
      priority:        entry.priority,
    },
    resolved: handoff?.resolved || {
      being:       activeRole,
      activeRole,
      spaceId,
    },
    identity: handoff?.identity || null,
    signal,
  };

  return { role, summonCtx };
}
