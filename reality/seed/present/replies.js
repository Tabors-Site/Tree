// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// How one moment begets the next. A reply is a SUMMON with
// `inReplyTo` set — the receiver of an earlier moment requesting
// the original asker have a follow-up moment in response. So
// replies aren't a separate primitive; they're the same envelope
// reaching the other direction, the chain of moments propagating
// up and down through whoever is involved.
//
// Both halves of the reply mechanism live here: emission and
// aggregation.
//
//   EMISSION  (emitReplyToAsker, emitReplyToStance)
//     A role's summon() has finished its moment and the role
//     wants someone else to have the next moment. I build the
//     reply envelope, hand it to summonByResolved, it lands in
//     the asker's inbox. The asker's next moment will respond to
//     it. defaultSummon is the canonical caller; every role that
//     passes its act back up a chain ends here.
//
//   AGGREGATION  (aggregate)
//     A role's summon() requested N sibling moments in parallel
//     and needs to wait for K of them to come back before its
//     own moment can continue. The aggregate handle lets the
//     caller await the gather and feed in arriving replies
//     through notify(). Foreman → Workers fanout is the
//     canonical user.
//
// Both halves share a discipline: neither touches the inbox
// directly. Emission writes through the verb (summonByResolved);
// aggregation never reads — replies are forwarded by the role's
// summon() handler via notify(). Only SUMMONs make SUMMONs, and
// replies are SUMMONs.
//
// findChainInitialCaller is the helper for Ruler-style replies
// where the immediate sender (a sub-being) is not the right
// receiver of the next moment. I walk the receiver's inbox to
// find the chain-opening SUMMON and return its `from` for
// emitReplyToStance — the next moment lands at the user-being or
// parent Ruler instead of the sub-being who happened to send the
// last request.

import { randomUUID } from "crypto";
import log from "../seedReality/log.js";
import Being from "../materials/being/being.js";
import { readInbox } from "./intake/inbox.js";
import { summonByResolved } from "../ibp/verbs/summon.js";
import { getRealityDomain } from "../ibp/address.js";

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

// Map the legacy numeric priority (1=HUMAN .. 4=BACKGROUND) used by
// inbox entries to the SUMMON envelope's enum. The Act record
// stores the enum; the scheduler still reads numerics from inbox
// entries for queue ordering, but new emits flow through the
// envelope contract and carry the enum.
const _PRIORITY_NUM_TO_ENUM = {
  1: "HUMAN",
  2: "GATEWAY",
  3: "INTERACTIVE",
  4: "BACKGROUND",
  5: "BACKGROUND",
};
function priorityEnumFor(n) {
  if (typeof n === "string") return n;
  return _PRIORITY_NUM_TO_ENUM[n] || "INTERACTIVE";
}

// Parse a stance string of the form `<reality>/<spaceId>@<qualifier>` into
// its parts. Replies build `from` fields in this shape; this is the
// inverse. Returns null on mismatch — callers log and skip the reply.
//
// Deliberately a small regex rather than the full IBP Address parser
// because the substrate convention is spaceId-as-path. If a future
// caller writes a fancier stance (path-by-name, bridged), this resolver
// upgrades to the full parser — but the failure mode is loud (returns
// null, helper logs and skips) rather than silent.
const STANCE_RE = /^([^/]+)\/([^/@]+)@([a-z][a-z0-9-]*)$/i;

function parseAskerStance(stance) {
  if (typeof stance !== "string") return null;
  const m = STANCE_RE.exec(stance.trim());
  if (!m) return null;
  return { reality: m[1], spaceId: m[2], qualifier: m[3] };
}

// ═════════════════════════════════════════════════════════════════
// RESPONSE ROW — shape what the scheduler pushes back
// ═════════════════════════════════════════════════════════════════

/**
 * Shape a moment's result into the response inbox row the scheduler
 * pushes back through handoff.onResponse. The mapping (text/content/
 * actId) is what role.summon returned; intake just routes the row.
 *
 * Sits with reply emission because it produces the same shape: an
 * inbox-bound envelope from a moment's outcome. moment.js stays pure
 * dispatch; this side of the seam owns the response row.
 */
export function buildResponseEntry({ result, handoff, originalEntry }) {
  if (!result || typeof result !== "object") return null;
  return {
    from:        handoff?.responseFromStance || null,
    content:     result.text ?? result.content ?? "",
    correlation: result.correlation || randomUUID(),
    inReplyTo:   originalEntry.correlation,
    sentAt:      new Date().toISOString(),
    actId:     result.actId || null,
  };
}

// ═════════════════════════════════════════════════════════════════
// EMISSION — wake whoever is waiting
// ═════════════════════════════════════════════════════════════════

/**
 * Emit a reply SUMMON to whoever originally addressed this being.
 *
 * Reads `originalMessage.from` (the asker's stance), resolves the
 * asker Being by name, and emits a SUMMON through summonByResolved
 * (which writes the inbox entry, wires the handoff, and wakes the
 * per-being scheduler — all atomically behind the envelope contract).
 *
 * Silent-best-effort on missing substrate: logs a warning, returns
 * false. Callers should not depend on the reply landing for
 * correctness . substrate is canonical; reply text is conversational
 * continuity.
 *
 * @param {object} opts
 * @param {string} opts.fromNodeId       Replier's home (scope spaceId)
 * @param {object} opts.fromBeing        Replier Being doc
 * @param {string} [opts.fromRoleName]   Stance qualifier; default fromBeing.name
 * @param {object} opts.originalMessage  Inbox entry being responded to (carries .from)
 * @param {string} opts.exitText         Reply content
 * @param {number|string} [opts.priority]  Default 3 / "INTERACTIVE"
 * @param {object} [opts.payload]        Extra structured data folded into content
 * @returns {Promise<boolean>}
 */
export async function emitReplyToAsker({
  fromNodeId,
  fromBeing,
  fromRoleName,
  originalMessage,
  exitText,
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("Replies", "missing fromNodeId; skipping reply emission");
    return false;
  }
  if (!originalMessage?.from) {
    log.warn(
      "Replies",
      `originalMessage.from missing; cannot route reply (correlation=${originalMessage?.correlation?.slice?.(0, 8) || "?"})`,
    );
    return false;
  }

  try {
    const askerStance = parseAskerStance(originalMessage.from);
    if (!askerStance) {
      log.warn(
        "Replies",
        `unparseable asker stance "${originalMessage.from}"; skipping reply`,
      );
      return false;
    }

    const askerBeing = await Being.findOne({ name: askerStance.qualifier })
      .select("_id name defaultRole roles")
      .lean();
    if (!askerBeing) {
      log.warn(
        "Replies",
        `asker being "${askerStance.qualifier}" not found; skipping reply`,
      );
      return false;
    }

    const realityDomain = getRealityDomain();
    if (!realityDomain) {
      log.debug(
        "Replies",
        `skipping reply: reality domain not yet available`,
      );
      return false;
    }
    const fromQualifier =
      fromRoleName ||
      fromBeing?.name ||
      (Array.isArray(fromBeing?.roles) && fromBeing.roles[0]) ||
      "sub-being";
    const fromStance = `${realityDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootCorrelation =
      originalMessage?.rootCorrelation ||
      originalMessage?.correlation ||
      correlation;

    const content = payload ? { exit: exitText, ...payload } : exitText;

    await summonByResolved({
      toBeingId:    String(askerBeing._id),
      inboxSpaceId: String(askerStance.spaceId),
      activeRole:   askerBeing.defaultRole || null,
      message: {
        from:            fromStance,
        content,
        correlation,
        rootCorrelation,
        activeRole:      askerBeing.defaultRole || null,
        inReplyTo:       originalMessage?.correlation || null,
        priority:        priorityEnumFor(priority),
        sentAt:          new Date().toISOString(),
      },
      identity: fromBeing
        ? { beingId: String(fromBeing._id), name: fromBeing.name }
        : null,
    });

    log.info(
      "Replies",
      `↩  ${fromQualifier} → ${askerBeing.name} ` +
        `at ${String(askerStance.spaceId).slice(0, 8)} ` +
        `(correlation=${correlation.slice(0, 8)})`,
    );
    return true;
  } catch (err) {
    log.warn("Replies", `emitReplyToAsker failed: ${err.message}`);
    return false;
  }
}

/**
 * Emit a SUMMON to an asker identified by a stance string directly.
 *
 * Used when the wake-asker (the being whose reply summoned us) is not
 * the stance we want to address. Rulers use this on reply-wakes to
 * route back to the chain-initial caller (user-being or parent Ruler)
 * rather than to the immediate sub-being sender.
 *
 * Parses the stance, resolves the asker Being by name, emits a SUMMON
 * through summonByResolved at that stance's position. Silent-best-
 * effort on missing substrate.
 *
 * @param {object} opts
 * @param {string} opts.askerStance      e.g. "treeos.ai/<userHomeId>@tabor"
 * @param {string} opts.fromNodeId       Replier's home (scope spaceId)
 * @param {object} opts.fromBeing        Replier Being doc
 * @param {string} [opts.fromRoleName]   Stance qualifier
 * @param {string} opts.exitText         Reply content
 * @param {string} [opts.inReplyTo]      Correlation of the wake-SUMMON
 * @param {string} [opts.rootCorrelation] Chain root (propagates from wake)
 * @param {number|string} [opts.priority]  Default 3 / "INTERACTIVE"
 * @param {object} [opts.payload]        Extra structured data folded into content
 * @returns {Promise<boolean>}
 */
export async function emitReplyToStance({
  askerStance,
  fromNodeId,
  fromBeing,
  fromRoleName,
  exitText,
  inReplyTo = null,
  rootCorrelation = null,
  priority = 3,
  payload = null,
}) {
  if (!fromNodeId) {
    log.warn("Replies", "missing fromNodeId; skipping stance reply");
    return false;
  }
  if (!askerStance) {
    log.warn("Replies", "missing askerStance; skipping stance reply");
    return false;
  }
  try {
    const parsed = parseAskerStance(askerStance);
    if (!parsed) {
      log.warn(
        "Replies",
        `unparseable asker stance "${askerStance}"; skipping reply`,
      );
      return false;
    }
    const askerBeing = await Being.findOne({ name: parsed.qualifier })
      .select("_id name defaultRole roles")
      .lean();
    if (!askerBeing) {
      log.warn(
        "Replies",
        `asker being "${parsed.qualifier}" not found; skipping reply`,
      );
      return false;
    }

    const realityDomain = getRealityDomain();
    if (!realityDomain) {
      log.debug(
        "Replies",
        `skipping reply: reality domain not yet available`,
      );
      return false;
    }
    const fromQualifier =
      fromRoleName ||
      fromBeing?.name ||
      (Array.isArray(fromBeing?.roles) && fromBeing.roles[0]) ||
      "sub-being";
    const fromStance = `${realityDomain}/${fromNodeId}@${fromQualifier}`;

    const correlation = randomUUID();
    const rootC = rootCorrelation || correlation;
    const content = payload ? { exit: exitText, ...payload } : exitText;

    await summonByResolved({
      toBeingId:    String(askerBeing._id),
      inboxSpaceId: String(parsed.spaceId),
      activeRole:   askerBeing.defaultRole || null,
      message: {
        from:            fromStance,
        content,
        correlation,
        rootCorrelation: rootC,
        activeRole:      askerBeing.defaultRole || null,
        inReplyTo,
        priority:        priorityEnumFor(priority),
        sentAt:          new Date().toISOString(),
      },
      identity: fromBeing
        ? { beingId: String(fromBeing._id), name: fromBeing.name }
        : null,
    });

    log.info(
      "Replies",
      `↩  ${fromQualifier} → ${askerBeing.name} ` +
        `at ${String(parsed.spaceId).slice(0, 8)} ` +
        `(correlation=${correlation.slice(0, 8)})`,
    );
    return true;
  } catch (err) {
    log.warn("Replies", `emitReplyToStance failed: ${err.message}`);
    return false;
  }
}

/**
 * Find the chain-initial caller for a being's inbox at a scope.
 *
 * Walks the being's inbox at scopeNodeId for the first entry where
 * `rootCorrelation` matches and `inReplyTo` is null . the chain-opening
 * SUMMON to this being, not a sub-being's reply.
 *
 * For an entry-scope Ruler this returns the user-being's stance.
 * For a sub-scope Ruler this returns the parent Ruler's stance.
 * Same mechanism, different identity. See memory `card-is-a-summon`.
 *
 * Returns the `from` field of the chain-initial entry, or null when
 * none is found.
 *
 * @param {string} scopeNodeId
 * @param {string} beingId
 * @param {string} rootCorrelation
 * @returns {Promise<string | null>}
 */
export async function findChainInitialCaller(
  scopeNodeId,
  beingId,
  rootCorrelation,
) {
  if (!scopeNodeId || !beingId || !rootCorrelation) return null;
  try {
    const entries = await readInbox(scopeNodeId, beingId);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    for (const entry of entries) {
      if (entry?.rootCorrelation === rootCorrelation && !entry.inReplyTo) {
        return entry.from || null;
      }
    }
    return null;
  } catch (err) {
    log.warn(
      "Replies",
      `findChainInitialCaller failed for being ${String(beingId).slice(0, 8)}/root ${String(rootCorrelation).slice(0, 8)}: ${err.message}`,
    );
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════
// AGGREGATION — gather N replies
// ═════════════════════════════════════════════════════════════════
//
// A being SUMMONs N other beings in parallel, then needs to act once
// all (or k-of-N) replies have landed in its inbox. The Foreman →
// Workers fanout is the canonical example: Foreman summons four
// Workers, each Worker eventually SUMMONs back with its result, the
// Foreman wakes once enough replies have arrived to make a decision.
//
// This helper is a thin coordination primitive over the inbox +
// scheduler. It does NOT poll. It registers an interest set with a
// matcher (correlation ids the caller is expecting, plus a predicate),
// and resolves when matching replies arrive. The caller drives
// delivery by notifying the aggregator from its own SUMMON-receiving
// path (typically inside the role template's `summon` handler).
//
// **Why not poll the inbox directly?** Polling adds latency and
// contention with the scheduler that's already serializing inbox
// writes. The aggregator instead piggybacks on the SUMMON-arrives
// moment: whenever a SUMMON places at the being, the role template
// forwards it through `notify(reply)`. If the reply matches an open
// aggregation, the aggregator resolves (or partially fills) without
// consulting the inbox.
//
// **Cancellation.** Aggregators carry an AbortSignal. When the
// caller's surrounding Act aborts, the aggregator settles with
// `cancelled: true` and any pending promise resolves with the
// partial replies it had so far. Used to keep Foreman from sitting
// on a dead aggregation when the Ruler cancels.
//
// **Timeout.** Optional. Defaults to none (waits forever). When set,
// an elapsed timeout settles the aggregator with `timedOut: true` and
// the partial replies it had collected so far.

/**
 * Begin an aggregation. Returns a handle the role template uses to
 * await the result and to feed in incoming replies.
 *
 * @param {object} opts
 * @param {string[]} opts.correlations   correlation ids the aggregator is waiting for
 * @param {number}   [opts.minReplies]   resolve as soon as this many match; default = correlations.length (all)
 * @param {number}   [opts.timeoutMs]    settle with timedOut=true after this long; default = no timeout
 * @param {AbortSignal} [opts.signal]    settle with cancelled=true when this aborts
 * @param {(reply) => boolean} [opts.matcher]  additional gate beyond inReplyTo matching
 *
 * @returns {{
 *   notify: (reply: object) => boolean,   // returns true if this reply matched
 *   wait:   () => Promise<{ replies: object[], timedOut: boolean, cancelled: boolean }>,
 *   abort:  () => void,
 * }}
 */
export function aggregate({
  correlations,
  minReplies,
  timeoutMs,
  signal,
  matcher,
} = {}) {
  if (!Array.isArray(correlations) || correlations.length === 0) {
    throw new Error("aggregate requires correlations[]");
  }
  const need =
    typeof minReplies === "number" && minReplies > 0
      ? Math.min(minReplies, correlations.length)
      : correlations.length;

  const want = new Set(correlations.map(String));
  const got = new Map(); // correlation -> reply (deduped)
  let resolveFn = null;
  let promise = null;
  let timeoutId = null;
  let abortHandler = null;
  let settled = false;

  function settle(payload) {
    if (settled) return;
    settled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (signal && abortHandler) {
      try {
        signal.removeEventListener("abort", abortHandler);
      } catch {}
      abortHandler = null;
    }
    resolveFn?.(payload);
  }

  function currentReplies() {
    // Return replies in the order their correlations were registered.
    return correlations.map((c) => got.get(String(c))).filter(Boolean);
  }

  function notify(reply) {
    if (settled) return false;
    if (!reply || typeof reply !== "object") return false;
    const matchId = reply.inReplyTo ? String(reply.inReplyTo) : null;
    if (!matchId || !want.has(matchId)) return false;
    if (got.has(matchId)) return false; // dedupe — first reply wins per correlation
    if (matcher && typeof matcher === "function") {
      let ok = false;
      try {
        ok = !!matcher(reply);
      } catch (err) {
        log.warn("Replies", `matcher threw: ${err.message}`);
      }
      if (!ok) return false;
    }
    got.set(matchId, reply);
    if (got.size >= need) {
      settle({ replies: currentReplies(), timedOut: false, cancelled: false });
    }
    return true;
  }

  function wait() {
    if (!promise) {
      promise = new Promise((resolve) => {
        resolveFn = resolve;
        if (settled)
          resolve({
            replies: currentReplies(),
            timedOut: false,
            cancelled: false,
          });
      });
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          settle({
            replies: currentReplies(),
            timedOut: true,
            cancelled: false,
          });
        }, timeoutMs);
      }
      if (signal) {
        if (signal.aborted) {
          settle({
            replies: currentReplies(),
            timedOut: false,
            cancelled: true,
          });
        } else {
          abortHandler = () => {
            settle({
              replies: currentReplies(),
              timedOut: false,
              cancelled: true,
            });
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }
    }
    return promise;
  }

  function abort() {
    settle({ replies: currentReplies(), timedOut: false, cancelled: true });
  }

  return { notify, wait, abort };
}
