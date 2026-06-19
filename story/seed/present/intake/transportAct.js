// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Transport-act dispatch. The seam between a being's transport and
// the factory's intake.
//
// ── The shape, truthfully named ─────────────────────────────────
//
// When a being acts from their own transport (portal click, browser
// form, CLI command, IDE keypress), the transport ISN'T the actor.
// The transport is matter — a channel, a UI, a wire. Only beings
// act. So an arriving keystroke isn't yet an act; it's a delivery.
//
// The architecture's response: convert "a keystroke reached the
// transport" into "the being is acting" via a self-SUMMON. The
// transport drops a wake-call into the being's inbox saying "your
// keystroke reached me; here's the act you indicated." The scheduler
// picks it; the being's moment opens; from inside the moment the
// being is the actor doing the act. The transport was the postman;
// the being is the originator.
//
// This is the model refusing to let the wire short-circuit into a
// being's reel. If the transport could directly stamp facts on the
// being's reel, the wire would be a second writer — same class of
// bug as opts.actor on createBeing or Mongoose timestamps:true
// overwriting projections. The transport-summon pattern enforces
// single-writer at the I/O boundary structurally: the wire CAN'T
// stamp anything on a being's reel; it can only summon the being,
// and the being's moment is what stamps.
//
// ── Why SUMMON and not a new verb ────────────────────────────────
//
// The model has exactly four verbs. SUMMON's whole job is "wake a
// being into a moment." Whether the wake comes from another being
// ("answer me"), a scheduled cadence ("your timer fired"), or a
// transport ("your keystroke arrived"), the being sees a wake-call
// land in its inbox and opens a moment. The being can't tell — and
// shouldn't tell — the difference. That's a sign the model is tight:
// the wire didn't need a new verb because SUMMON already covered it.
//
// ── transportAct: true is a semantic mode, not a structural carve-out
//
// Most summons drive cognition: the role's summon(message, ctx)
// handler deliberates on the message and decides what (if anything)
// to do. Transport-summons drive execution: the being already chose
// before the keystroke fired; the wake-call's payload is a
// pre-decided act, not a message to deliberate on. The kind:
// "transport-act" flag is the architecture saying "skip deliberation;
// the being already chose." Same machinery; two semantic modes.
//
// ── The two-fact-per-click thing ────────────────────────────────
//
// Every transport interaction puts two facts on the being's reel:
//   - summon (transportAct:true) — the wake-call: "I summoned
//     myself via the wire."
//   - the inner do:* / be:* — the act itself.
//
// Both are real history. The summon records HOW the moment opened;
// the inner fact records WHAT the being did. Open design question
// worth bookmarking: whether transport-bookkeeping summons should
// share a reel with deliberate being-to-being summons. They're both
// legitimately summons (the primitive is the same), but they're
// different kinds of history. Not deciding now; the current shape
// is honest and the verbosity is bearable.
//
// ── Concrete contract ───────────────────────────────────────────
//
// The wire layer (WS/HTTP/CLI handlers) calls dispatchTransportAct({
// beingId, act, correlation, identity }) when a transport-arriving
// keystroke needs to become the being's act. The helper:
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
// ── On the async shape ──────────────────────────────────────────
// The wire DO contract is fundamentally asynchronous. A
// transport-summon may open a moment that SUMMONs other beings
// whose own moments cascade. The tail of that cascade is what the
// originating socket actually wants back, and it has no time bound.
// There is no correct ack timeout because the quantity being
// timed isn't the wire layer's to bound. The correct shape is:
// ack immediately with a correlationId; push the result through
// the same `ibp` channel (verb: "moment") when it arrives.

import { randomUUID } from "crypto";
import { enqueueIntake } from "./intake.js";
import { attachHandoff, wake } from "./scheduler.js";
import { loadProjection } from "../../materials/projections.js";

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
 * @param {object} opts.act            — { verb: "do"|"be"|"name", act, target, args } (`act` = the operation in flight)
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
  branch,
  targetHistory = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!beingId) throw new Error("dispatchTransportAct requires beingId");
  if (!act || typeof act !== "object") {
    throw new Error("dispatchTransportAct requires act { verb, target, action, args }");
  }
  if (act.verb !== "do" && act.verb !== "be" && act.verb !== "call" && act.verb !== "name") {
    throw new Error(`dispatchTransportAct: act.verb must be "do", "be", "call", or "name" (got "${act.verb}")`);
  }
  // Branch is REQUIRED — no main-bias default. The wire layer parses
  // the address and attaches the branch to every transport-act; this
  // throw catches a caller that forgot to thread it.
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error(
      `dispatchTransportAct: branch is required (got ${JSON.stringify(branch)}). ` +
      `Thread the wire-parsed branch through; no main-bias default.`,
    );
  }
  // targetHistory defaults to branch when not specified — same-world
  // call. When set explicitly different from branch, this is a
  // cross-world dispatch: the moment opens on the actor's branch but
  // the Fact lands on the target's branch with crossOrigin marking
  // the actor's. See CROSS-WORLD.md.
  const resolvedTargetHistory = (typeof targetHistory === "string" && targetHistory.length > 0)
    ? targetHistory
    : branch;

  const finalCorrelation = correlation || randomUUID();

  // Resolve intake-storing space. Stopgap: Being.homeSpace. Real
  // fix is being-keyed intake storage so this lookup goes away.
  let resolvedSpace = spaceId;
  if (!resolvedSpace) {
    // Branch-aware: the moment runs in the caller's branch; the
    // intake-storing space comes from the being's state in that branch.
    // loadOrFold triggers a lineage-cold-fold on miss so a being that
    // existed pre-branch shows up in the branch's view on first access
    // without a manual rebuild. Returns null if the being didn't exist
    // at this branch's branchPoint (legitimate "not here").
    const { loadOrFold } = await import("../../materials/projections.js");
    const slot = await loadOrFold("being", beingId, branch);
    resolvedSpace = slot?.state?.homeSpace || null;
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
    // Two branches carried per the cross-world doctrine:
    //   branch       — the ACTOR's branch; where the moment runs and
    //                  where the Act seals. assign.js reads this when
    //                  shaping moment and seating the actorAct.
    //   targetHistory — where the Fact lands (the TARGET'S branch).
    //                  Defaults to branch (same-world). When different,
    //                  emitFact's deriveCrossOrigin attaches a
    //                  provenance block automatically.
    branch,
    targetHistory: resolvedTargetHistory,
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
