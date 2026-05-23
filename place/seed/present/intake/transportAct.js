// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Transport-act dispatch. The seam between a being's transport and
// the factory's intake.
//
// A being acting from their own transport (portal click, browser
// form, CLI command, IDE keypress) is NOT a SUMMON. No envelope
// reaches them; their own realm decides what to do and emits the
// verb. But every DO/BE in the system must ride an ambient
// actId, and assign is the sole legitimate Act opener. So
// transport-emitted acts can't call doVerb/beVerb directly — they
// have to enter through intake the same way SUMMONs do.
//
// This helper is the entry point. The wire layer (WS/HTTP/CLI
// handlers) calls dispatchTransportAct({ beingId, act, correlation,
// identity }) when a transport-authenticated being emits a DO or
// BE. The helper:
//
//   1. Resolves the intake-storing space — Being.homeSpace by
//      default. This is a stopgap: intake is being-keyed
//      conceptually, only pinned to a Space because today's
//      storage shape requires one. Per-being serial doesn't care.
//   2. Enqueues a "transport-act" intake entry under the supplied
//      correlation. The correlation is the idempotency key — a
//      retry with the same id collapses to one entry (one moment),
//      and re-awaiters get the moment's result regardless of who
//      originally enqueued it.
//   3. Returns synchronously with { correlation, awaitResult }.
//      The wire layer can ack the correlation immediately and
//      either await the result Promise (HTTP long-poll mode) or
//      attach a push-emitter (WS async mode) and return.
//
// SEE never reaches here. Reads are synchronous folds with no
// state change, no Fact, no Act.
//
// ── On the new shape ─────────────────────────────────────────────
// The wire DO contract is fundamentally asynchronous. A
// transport-act may trigger a moment that SUMMONs other beings
// whose own moments cascade. The tail of that cascade is what the
// transport caller actually wants back, and it has no time bound.
// There is no correct ack timeout because the quantity being
// timed isn't the wire layer's to bound. The correct shape is:
// ack immediately with a correlationId; push the result through
// the same `ibp` channel (verb: "moment") when it arrives.

import Being from "../../models/being.js";
import { randomUUID } from "crypto";
import { enqueueIntake } from "./intake.js";
import { attachHandoff, wake } from "./scheduler.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Dispatch a being's transport-act through the stamper.
 *
 * Idempotent on `correlation`: the same correlation enqueues once
 * and produces one moment, no matter how many times the wire layer
 * calls in. Multiple awaiters all resolve when the moment seals.
 *
 * @param {object} opts
 * @param {string} opts.beingId        — the acting being's id
 * @param {object} opts.act            — { verb: "do"|"be", target, action, args }
 * @param {string} [opts.correlation]  — client-supplied idempotency key (recommended); auto-generated if omitted
 * @param {string} [opts.spaceId]      — intake-storing space; defaults to Being.homeSpace
 * @param {object} [opts.identity]     — { beingId, name }
 * @param {string|number} [opts.priority]
 * @param {number} [opts.timeoutMs]    — bound on awaitResult only (default 60s); the moment itself is unbounded
 *
 * @returns {Promise<{
 *   correlation: string,
 *   awaitResult: Promise<{ result: any, actId: string|null }>,
 *   deduped: boolean,
 * }>}
 */
export async function dispatchTransportAct({
  beingId,
  act,
  correlation,
  spaceId,
  identity = null,
  priority,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!beingId) throw new Error("dispatchTransportAct requires beingId");
  if (!act || typeof act !== "object") {
    throw new Error("dispatchTransportAct requires act { verb, target, action, args }");
  }
  if (act.verb !== "do" && act.verb !== "be") {
    throw new Error(`dispatchTransportAct: act.verb must be "do" or "be" (got "${act.verb}")`);
  }

  const finalCorrelation = correlation || randomUUID();

  // Resolve intake-storing space. Stopgap: Being.homeSpace. Real
  // fix is being-keyed intake storage so this lookup goes away.
  let resolvedSpace = spaceId;
  if (!resolvedSpace) {
    const beingRow = await Being.findById(beingId).select("homeSpace").lean();
    resolvedSpace = beingRow?.homeSpace || null;
  }
  if (!resolvedSpace) {
    throw new Error(
      `dispatchTransportAct: no intake-storing space for being ${beingId.slice(0, 8)} ` +
        `(no spaceId supplied and Being.homeSpace is unset)`,
    );
  }

  const enqueued = await enqueueIntake(resolvedSpace, beingId, {
    kind:        "transport-act",
    correlation: finalCorrelation,
    act,
    identity,
    priority,
  });

  const awaitResult = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`transport-act awaitResult timeout after ${timeoutMs}ms (correlation=${finalCorrelation.slice(0, 8)})`));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    attachHandoff(beingId, finalCorrelation, {
      identity,
      onResponse: (payload) => finish(resolve, payload || { result: null, actId: null }),
      onError:    (err)     => finish(reject, err),
    });
  });

  // If the entry was deduped, the original moment may have already
  // finished. attachHandoff still registers; the result-replay path
  // in the scheduler is the follow-up that re-fires for late
  // attachers. For now, dedupe + post-completion attach means the
  // promise will time out — callers can read entry.responseId /
  // entry.actId via SEE to discover the prior result.
  wake(beingId, resolvedSpace);

  return {
    correlation: finalCorrelation,
    awaitResult,
    deduped: !!enqueued.deduped,
  };
}
