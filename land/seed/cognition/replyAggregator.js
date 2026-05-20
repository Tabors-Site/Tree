// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Reply aggregation helper.
//
// Pattern: a being SUMMONs N other beings in parallel, then needs to act
// once all (or k-of-N) replies have landed in its inbox. The Foreman →
// Workers fanout is the canonical example: Foreman summons four Workers,
// each Worker eventually SUMMONs back with its result, the Foreman wakes
// once enough replies have arrived to make a decision.
//
// This helper is a thin coordination primitive over the inbox + scheduler.
// It does NOT poll. It registers an interest set with a matcher
// (correlation ids the caller is expecting, plus a predicate), and
// resolves when matching replies arrive. The caller drives delivery by
// notifying the aggregator from its own SUMMON-receiving path (typically
// inside the role template's `summon` handler).
//
// **Why not poll the inbox directly?** Polling adds latency and contention
// with the scheduler that's already serializing inbox writes. The
// aggregator instead piggybacks on the SUMMON-arrives moment: whenever a
// SUMMON lands at the being, the role template forwards it through
// `notifyReply(reply)`. If the reply matches an open aggregation, the
// aggregator resolves (or partially fills) without consulting the inbox.
//
// **Cancellation.** Aggregators carry an AbortSignal. When the caller's
// surrounding Summon aborts, the aggregator settles with `cancelled: true`
// and any pending promise rejects with an AbortError. Used to keep
// Foreman from sitting on a dead aggregation when the Ruler cancels.
//
// **Timeout.** Optional. Defaults to none (waits forever). When set, an
// elapsed timeout settles the aggregator with `timedOut: true` and the
// partial replies it had collected so far.

import log from "../system/log.js";

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

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
export function aggregate({ correlations, minReplies, timeoutMs, signal, matcher } = {}) {
  if (!Array.isArray(correlations) || correlations.length === 0) {
    throw new Error("aggregate requires correlations[]");
  }
  const need = typeof minReplies === "number" && minReplies > 0
    ? Math.min(minReplies, correlations.length)
    : correlations.length;

  const want = new Set(correlations.map(String));
  const got = new Map();         // correlation -> reply (deduped)
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
      try { signal.removeEventListener("abort", abortHandler); } catch {}
      abortHandler = null;
    }
    resolveFn?.(payload);
  }

  function currentReplies() {
    // Return replies in the order their correlations were registered.
    return correlations
      .map((c) => got.get(String(c)))
      .filter(Boolean);
  }

  function notify(reply) {
    if (settled) return false;
    if (!reply || typeof reply !== "object") return false;
    const matchId = reply.inReplyTo ? String(reply.inReplyTo) : null;
    if (!matchId || !want.has(matchId)) return false;
    if (got.has(matchId)) return false; // dedupe — first reply wins per correlation
    if (matcher && typeof matcher === "function") {
      let ok = false;
      try { ok = !!matcher(reply); } catch (err) {
        log.warn("ReplyAggregator", `matcher threw: ${err.message}`);
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
        if (settled) resolve({ replies: currentReplies(), timedOut: false, cancelled: false });
      });
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          settle({ replies: currentReplies(), timedOut: true, cancelled: false });
        }, timeoutMs);
      }
      if (signal) {
        if (signal.aborted) {
          settle({ replies: currentReplies(), timedOut: false, cancelled: true });
        } else {
          abortHandler = () => {
            settle({ replies: currentReplies(), timedOut: false, cancelled: true });
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
