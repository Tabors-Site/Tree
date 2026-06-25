// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Facts. The reel of stamped acts.
//
// A being is its acts. The Being row in the store is where the reel
// attaches; the reel itself, every Fact the being has stamped, is
// the identity. Without acts, the union of space and matter has
// nothing to be. The being is made of the acts unfolding.
//
// A Fact is a thing a being stamps in the Factory — one recorded
// change to matter, space, or being. `factum`, a thing done.
// A single fact is small but settled; a chain of facts, folded,
// is Truth.
//
// This file writes and reads that reel. logFact is called from the
// IBP verb dispatcher every time DO or BE places an act. The Fact
// row names the actor (through), the kind of act (verb, act), the
// object (space | matter | being | place | stance), and the input /
// output. getFacts and getFactsByBeing return the reel to readers.
//
// Universal over substrate. Facts attach to any target kind, so this
// file lives directly under place/ rather than inside one primitive's
// subfolder.
//
// Recorded by default. Operations opt out via `spec.skipAudit`; the
// dispatcher also accepts `opts.skipAudit` for seed-trusted batches.
//
// See seed/philosophy/MATERIALS.md "And the beings are the acts" for the
// philosophy behind why this reel is identity-load-bearing.

import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import * as fileStore from "../fileStore.js";
import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { resolveSpaceAccess } from "../../materials/space/spaces.js";
import { redactSecrets } from "../../materials/redact.js";

// Reel-bearing target kinds — those with their own seq counter. Other
// kinds (place, stance) and target-less facts carry seq:null and stay
// outside the fold model for now.
const REEL_KINDS = new Set(["being", "space", "matter", "library"]);

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

function MAX_PAYLOAD_BYTES() {
  const raw =
    Number(getInternalConfigValue("qualityNamespaceMaxBytes")) || 524288;
  return Math.max(1024, Math.min(raw, 2 * 1024 * 1024));
}
const MAX_ACTION_LENGTH = 100;
// The three stamping verbs. SEE never appends a Fact.
//   - do: act on an object (right stance). of.kind ∈ {space, matter, being, place, stance}.
//   - be: identity acting on self (left stance). of.kind === "being".
//   - summon: one being calling another (right stance, the recipient). of.kind === "being".
const VALID_VERBS = new Set(["do", "be", "call", "name"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "name",
  "library",
  "place",
  "stance",
]);
// Per-verb target-kind constraint. DO accepts any kind; BE and
// SUMMON always act on a being. Enforced in logFact below so a
// caller can't slip a `verb:"be" of:{kind:"matter"}` past the
// guard and confuse the fold or the inner/outer classifier.
const BEING_ONLY_TARGET_VERBS = new Set(["be", "call"]);

/**
 * Act a Fact onto the reel.
 *
 * @param {object} params           the fact spec (see fields below)
 * @param {string} params.through   actor (I for scaffold flows)
 * @param {string} params.act       operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be" | "summon"
 * @param {{kind:string,id:string}|null} [params.of]  what was acted on.
 *   When verb is "be" or "summon", of.kind MUST be "being" (enforced).
 * @param {*} [params.params]       input payload (any JSON; clipped on cap)
 * @param {*} [params.result]       output payload (any JSON; clipped on cap)
 * @param {string|null} [params.actId]   correlation
 * @param {string|null} [params.sessionId]  correlation
 * @param {string|null} [params.homeStory]   federation provenance
 * @param {boolean} [params.wasRemote=false] federation provenance
 * @param {object} [opts]                runtime options (NOT part of the fact)
 * @param {object} [opts.session] transactional-participation token, accepted
 *   for signature parity. Under the file store the single global commit
 *   mutex serializes the append, so this is no longer load-bearing: logFact
 *   runs its own per-reel atomic commit (singleton ΔF) whether or not it is
 *   present. Documented but unused.
 * @param {boolean} [opts.skipEagerFold=false] When true, do not call
 *   the foldEngine's eager-fold after insert. sealFacts sets this when
 *   committing transactionally — folds run after commit on the
 *   committed state, not during the transaction (which would race).
 *
 * The `beforeFact` hook receives a mutable view of these fields and may
 * cancel the stamp or enrich the payload before insert.
 */
export async function logFact(input, opts = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("logFact requires a params object");
  }
  // `history` is `let` because heaven routing may rewrite it below.
  // Everything else stays effectively-const.
  let history;
  const {
    through,
    by = null,
    verb = "do",
    act,
    of = null,
    params = null,
    result = null,
    actId = null,
    sessionId = null,
    homeStory = null,
    wasRemote = false,
    foldSeq = null,
  } = input;
  // History this fact lives on (target reel's history). REQUIRED.
  // Callers derive it from the target address (where the Fact lands)
  // — not from the actor's history. For same-world Facts the two
  // happen to match; for cross-world Facts they differ. See
  // CROSS-WORLD.md.
  history = input.history;

  // EMBODIMENT (see below): WORLD facts (do/be/summon) require `through` (a body); the ONE
  // bodiless case is the name/identity-and-5D layer — verb:"name" facts (declare/banish on the
  // name reel, and the 5D library acts share-book/peer-add/config on the library reel) are signed
  // by the Name with NO being (5d.md: the being stays home; only the name acts there). Those
  // require `by` (the signer) instead of `through`.
  if ((!through && verb !== "name") || !act) {
    throw new Error(
      "logFact requires through (or, for verb:name, a bodiless name-act) and act",
    );
  }
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `logFact: history is required (got ${JSON.stringify(history)}). ` +
        `Derive it from the target's address (the reel where this Fact lands), ` +
        `not from the actor's history.`,
    );
  }
  if (typeof act !== "string" || act.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `logFact: act must be a string under ${MAX_ACTION_LENGTH} chars`,
    );
  }
  if (!VALID_VERBS.has(verb)) {
    throw new Error(
      `logFact: verb must be one of ${[...VALID_VERBS].join("|")}`,
    );
  }

  // EMBODIMENT invariant (Tabor): a name makes WORLD facts (do / be / summon)
  // ONLY by acting THROUGH a being — every world fact carries the actor being
  // (the `through` REQUIRED above is that structural guarantee; there is no
  // bodiless world fact). The only thing a name acts on WITHOUT a being is the
  // name chain itself — NAME-verb facts (verb:"name": declare/connect/release/
  // banish), the identity layer outside the world. SEE never reaches logFact (a
  // read, no fact). A name with no being of its OWN acts through the shared
  // @arrival being; the wire (protocols/ibp/verbs/*) seats @arrival as the
  // actor for a name-only socket's world verb, so it is never bodiless.

  let normalizedTarget = null;
  if (of && typeof of === "object") {
    if (of.kind && !VALID_TARGET_KINDS.has(of.kind)) {
      throw new Error(
        `logFact: of.kind must be one of ${[...VALID_TARGET_KINDS].join("|")}`,
      );
    }
    if (of.kind || of.id) {
      normalizedTarget = {
        kind: of.kind || null,
        id: of.id != null ? String(of.id) : null,
      };
    }
  }

  // Heaven routing: facts targeting a heaven space always land on
  // history="0". The doctrine is that heaven entries have one
  // projection per story regardless of caller's history . the same
  // applies to their fact streams. Without this rewrite, a set-space
  // call from #1 against a heaven space would create a per-history
  // reel, defeating the doctrine.
  //
  // Only applies to space targets (heaven is by space); being and
  // matter targets keep their requested history.
  if (
    normalizedTarget &&
    normalizedTarget.kind === "space" &&
    normalizedTarget.id &&
    history !== "0"
  ) {
    try {
      const { isHeavenSpace } =
        await import("../../materials/space/heavenLineage.js");
      if (await isHeavenSpace(normalizedTarget.id)) {
        history = "0";
      }
    } catch {
      // Heaven classifier unavailable (pre-bootstrap): leave history
      // as-is. Genesis paths always pass history="0" anyway.
    }
  }

  // Subtree-scope gate. When the history declares a scope (a space
  // subtree), writes to aggregates outside the scope refuse loud.
  // Heaven writes routed above are exempt (heaven targets bypass this
  // check by virtue of history already being "0"). The check is a
  // single classifier hit + an ancestor walk on miss; cached.
  //
  // Doctrine: subtree histories let operators experiment on one feature
  // without contaminating the rest of the story. Outside the scope,
  // the history is transparent (reads inherit from parent); inside,
  // it diverges normally. Writes outside the scope are loud bugs
  // (you forgot to switch histories), not silent forwards.
  if (
    normalizedTarget &&
    normalizedTarget.kind &&
    normalizedTarget.id &&
    history !== "0"
  ) {
    // Load the scope module separately from running the check. A load
    // failure is a genuine pre-bootstrap signal (history infra not yet
    // loaded) and is safe to swallow. But the check ITSELF must FAIL
    // CLOSED: if getHistoryScopeSpaceId / isTargetInHistoryScope throws
    // (a resolver bug, a missing history row), the write is REFUSED,
    // not silently allowed. A scope gate that fails open is no gate —
    // an out-of-scope write would slip through on any internal error.
    let scopeMod = null;
    try {
      scopeMod = await import("../../materials/history/historyScope.js");
    } catch {
      scopeMod = null; // pre-bootstrap: history infra not loaded
    }
    if (scopeMod) {
      const { isTargetInHistoryScope, getHistoryScopeSpaceId } = scopeMod;
      let scopeSpaceId;
      try {
        scopeSpaceId = await getHistoryScopeSpaceId(history);
      } catch (err) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `SCOPE_CHECK_FAILED: could not resolve scope for history "#${history}" ` +
            `(${err.message}); refusing the write rather than bypass the gate.`,
          { history, target: normalizedTarget },
        );
      }
      if (scopeSpaceId) {
        let allowed;
        try {
          allowed = await isTargetInHistoryScope(history, normalizedTarget);
        } catch (err) {
          throw new IbpError(
            IBP_ERR.FORBIDDEN,
            `SCOPE_CHECK_FAILED: scope test threw for history "#${history}" ` +
              `target ${normalizedTarget.kind}:${normalizedTarget.id} ` +
              `(${err.message}); refusing the write rather than bypass the gate.`,
            { history, target: normalizedTarget, scopeSpaceId },
          );
        }
        if (!allowed) {
          throw new IbpError(
            IBP_ERR.FORBIDDEN,
            `SCOPE_VIOLATION: history "#${history}" is scoped to a subtree and ` +
              `cannot write to ${normalizedTarget.kind}:${normalizedTarget.id} ` +
              `(outside scope spaceId "${scopeSpaceId}"). ` +
              `Switch to the parent history to act on out-of-scope targets, ` +
              `or widen the history's scope via re-creation.`,
            { history, target: normalizedTarget, scopeSpaceId },
          );
        }
      }
    }
  }

  // Per-verb target-kind constraint. BE acts on the actor's own
  // identity; SUMMON acts on the recipient. Both are always being-
  // targeted. Only DO can target a non-being kind (space, matter,
  // place, stance). Catches mis-routed facts at the stamp boundary
  // before they reach the fold or the inner/outer classifier.
  if (BEING_ONLY_TARGET_VERBS.has(verb)) {
    if (!normalizedTarget || normalizedTarget.kind !== "being") {
      throw new Error(
        `logFact: verb "${verb}" requires of.kind === "being" (got ${normalizedTarget?.kind ?? "(none)"})`,
      );
    }
  }

  // Death gate (seed/done/DualBeingParents — "be:death freezes both
  // chains"). Refuse to stamp any Fact whose actor or being-target is
  // already dead. The lone exception is the be:death fact itself —
  // without it the lock can never seal. Past acts + grants stay in
  // the chain (this gate runs at stamp time, not at fold time).
  //
  // Reads via loadOrFold on the Fact's history, so divergent sub-
  // histories see their own view of liveness. The seed's I-Am and
  // pre-bootstrap moments emit Facts before any Being row exists;
  // isBeingDead returns false for a missing row so genesis isn't
  // blocked. Death stamps land on actual beings only.
  const { isBeingDead, isDeathFact } =
    await import("../../materials/being/closure.js");
  if (!isDeathFact({ verb, act })) {
    if (through && (await isBeingDead(through, history))) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `logFact: being ${String(through).slice(0, 8)} is closed (be:death). ` +
          `The actor chain is frozen; no new facts can ride this being.`,
        { through },
      );
    }
    if (
      normalizedTarget?.kind === "being" &&
      normalizedTarget?.id &&
      String(normalizedTarget.id) !== String(through) &&
      (await isBeingDead(normalizedTarget.id, history))
    ) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `logFact: target being ${String(normalizedTarget.id).slice(0, 8)} is closed (be:death). ` +
          `The being chain is frozen; no new facts can land on this being's reel.`,
        { targetBeingId: normalizedTarget.id },
      );
    }
  }

  // Banish gate — the Name layer's be:death. Refuse to stamp any fact whose
  // ACTOR name (by) is banished. The lone exception is the name:banish
  // fact itself, so the tombstone can seal. A Name is story-wide (its reel
  // does not fork), so this reads on main regardless of the fact's history;
  // isNameBanished short-circuits I, so today's all-i-am traffic skips the
  // read. See materials/name/closure.js.
  const { isNameBanished, isBanishFact } =
    await import("../../materials/name/closure.js");
  if (!isBanishFact({ verb, act }) && by && (await isNameBanished(by))) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `logFact: name ${String(by).slice(0, 8)} is banished. ` +
        `No new fact can be signed by it.`,
      { by },
    );
  }

  // beforeFact hook . extensions can modify or cancel. The hook sees a
  // mutable view; only `params` and `result` are conventionally mutated
  // for enrichment. Cancellations short-circuit the stamp.
  const hookData = {
    through,
    verb,
    act,
    of: normalizedTarget,
    params,
    result,
    actId,
    sessionId,
    homeStory,
    wasRemote,
  };
  const hookResult = await hooks.run("beforeFact", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut
      ? IBP_ERR.HOOK_TIMEOUT
      : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(
      code,
      `Fact cancelled: ${hookResult.reason || "extension"}`,
    );
  }

  const cappedParams = capPayload(hookData.params, "params");
  const cappedResult = capPayload(hookData.result, "result");
  const truncated = cappedParams.truncated || cappedResult.truncated;

  const finalTarget = hookData.of || normalizedTarget;

  // Foreign-origin idempotency. Per CROSS-WORLD.md "Idempotency on
  // the foreign side": when a Fact arrives carrying a crossOrigin
  // block, it's a cross-world act being stamped on this substrate.
  // Network retries, double-canopy deliveries, and replays produce
  // the same Fact more than once with the same crossOrigin.actId; the
  // receiving Stamper must dedup so the foreign reel doesn't grow
  // duplicates. The dedup key is {originStory, originHistory,
  // originBeingId, originActId} (full provenance tuple); we check by
  // crossOrigin.actId first since actId is unique enough in practice,
  // and the broader tuple guards against pathological reuse.
  const incomingCrossOrigin =
    hookData.params?.crossOrigin || cappedParams.value?.crossOrigin;
  if (incomingCrossOrigin?.actId && finalTarget) {
    // History-scoped: the delivery targets a specific world; a sibling
    // history holding the same crossOrigin tuple is a different reel and
    // must not suppress this stamp. Scan THIS reel (own-history) for a
    // prior fact carrying the same crossOrigin provenance tuple.
    const reel = fileStore.readReel(history, finalTarget.kind, finalTarget.id);
    const existing = reel.find(
      (f) =>
        f?.params?.crossOrigin?.actId === incomingCrossOrigin.actId &&
        f?.params?.crossOrigin?.beingId === incomingCrossOrigin.beingId,
    );
    if (existing) {
      // Duplicate delivery — return without writing. Caller treats
      // this as success (the fact already landed on a prior delivery).
      return { _id: existing._id, seq: existing.seq, deduped: true };
    }
  }

  const baseDoc = {
    through,
    by,
    verb,
    act,
    of: finalTarget,
    params: cappedParams.value,
    result: cappedResult.value,
    truncated,
    actId,
    sessionId,
    homeStory: hookData.homeStory ?? homeStory,
    wasRemote: Boolean(hookData.wasRemote ?? wasRemote),
    foldSeq: typeof foldSeq === "number" ? foldSeq : null,
    date: new Date(),
    history,
  };

  // Reel-bearing path: one moment = one fact. FileStore.commitMoment is
  // THE atomic write — it computes seq/p/_id ONCE from the reel's .head
  // (the seq counter + chain root), journals the moment (WAL+fsync, the
  // commit point), applies the fact line to the reel idempotently, then
  // advances the head. The single global commit mutex serializes every
  // write, so there is no append lock, no transaction, no replica set:
  // the seq alloc + prev-hash chain + insert that withReelLock once
  // wrapped all collapse into commitMoment. The fact _id is
  // computeHash(p, contentOf(fact)), the store's content-hash _id, so
  // folds stay byte-compatible. spec = baseDoc (the fact content; never
  // seq/p/_id, which commitMoment derives).
  //
  // Target-less or place/stance facts have no reel; they still land
  // as a single-fact moment keyed by (history, kind, id).
  const { skipEagerFold = false } = opts;
  if (finalTarget && REEL_KINDS.has(finalTarget.kind) && finalTarget.id) {
    try {
      await fileStore.commitMoment({
        facts: [
          {
            history,
            kind: finalTarget.kind,
            id: String(finalTarget.id),
            spec: baseDoc,
          },
        ],
      });
    } catch (err) {
      log.error(
        "DB",
        `Fact append failed (${act} on ${finalTarget.kind}:${finalTarget.id} history=${history}): ${err.message}`,
      );
      const wrapped = new Error(
        `Failed to stamp Fact (${history}:${finalTarget.kind}:${finalTarget.id} ${act}): ${err.message}`,
      );
      wrapped.cause = err;
      if (err?.code) wrapped.code = err.code;
      throw wrapped;
    }

    // Eager-fold. Per STAMPER.md Decision: "eager-fold is an inline
    // call to `fold(target)`. Not a second projection-writer." The
    // fold engine's compare-and-set handles concurrency; failure here
    // is harmless — the next fold round self-heals. Skipped when the
    // caller (sealFacts) folds after the whole ΔF commits.
    if (!skipEagerFold) {
      try {
        const { fold } =
          await import("../../present/stamper/2-fold/foldEngine.js");
        // Fold runs on the SAME history the fact landed on. Without
        // threading it the fold engine throws "history is required"
        // (post-doctrine-shift) and the seal aborts. (fold takes
        // the option key `history`; see foldEngine.js.)
        await fold(finalTarget.kind, finalTarget.id, { history });
      } catch (err) {
        // Self-healing: the next fold catches up. Log but don't throw —
        // the fact is the source of truth and is already on disk.
        log.debug(
          "Fold",
          `eager-fold failed for ${finalTarget.kind}:${finalTarget.id}: ${err.message}`,
        );
      }
    }
  } else {
    // Non-reel-bearing path (place/stance/target-less): no fold to run,
    // but the fact still commits as a single-fact moment. commitMoment
    // computes its content-hash identity; replay is idempotent.
    const okind = finalTarget?.kind || "stance";
    const oid = finalTarget?.id != null ? String(finalTarget.id) : act;
    try {
      await fileStore.commitMoment({
        facts: [{ history, kind: okind, id: oid, spec: baseDoc }],
      });
    } catch (err) {
      log.error("Store", `Fact save failed (${act}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// sealFacts — the seal is the unit of commit (atomicity for ΔF).
// ─────────────────────────────────────────────────────────────────────
//
// MODEL.md ATOMIC SEAL: commit(ΔF) ∈ {all, nothing}. ΔF can span
// multiple reels. The whole set commits as one unit. FileStore's
// commitMoment IS that unit: one record carrying every fact in the ΔF,
// WAL-appended + fsync'd as one frame (the commit point) under the
// single global commit mutex, then applied to the reels idempotently.
// No transaction, no replica set, no append lock — the mutex serializes
// everything; a crash replays the WAL record atomically (all-or-nothing
// by the frame's CRC). One act → one ΔF → one commitMoment.
//
// Eager-fold runs AFTER commit, not inside, so projections see the
// committed state. The fact-chain is the source of truth; projections
// self-heal even without eager-fold.

/**
 * Group a ΔF by reel and sort the reels by key. Centralizes the
 * grouping so sealFacts and sealAct produce identical lock-order
 * for the same ΔF.
 *
 *   - Reel-bearing facts (of.kind in REEL_KINDS, of.id set)
 *     bucket by "<kind>:<id>".
 *   - Non-reel-bearing facts (place/stance, target-less) accumulate
 *     in orphanFacts and commit without a reel lock — they only
 *     ride the session for atomicity.
 *
 * Sorted order is deterministic and identical across callers, so
 * two concurrent transactions touching the same set of reels
 * acquire locks in the same order and cannot deadlock.
 *
 * @param {Array<object>} deltaF
 * @returns {{ sortedReels: Array<{kind,id,facts}>, orphanFacts: Array<object> }}
 */
export function groupByReel(deltaF) {
  const factsByReel = new Map();
  const orphanFacts = [];
  for (const spec of deltaF) {
    const of = spec?.of;
    if (of && REEL_KINDS.has(of.kind) && of.id) {
      // Reel identity is (history, kind, id). A fact on history=1
      // targeting being:X writes a different reel than a fact on
      // history=0 targeting the same being. logFact already required
      // history upstream, so here we hold the caller to it — no silent
      // remap to main. If history is absent we throw rather than guess.
      if (typeof spec.history !== "string" || !spec.history.length) {
        throw new Error(
          `groupByReel: fact spec is missing history (${spec.verb}:${spec.act} on ` +
            `${of.kind}:${String(of.id).slice(0, 8)}). Upstream caller must thread it.`,
        );
      }
      const history = spec.history;
      const key = `${history}:${of.kind}:${of.id}`;
      const entry = factsByReel.get(key) || {
        history,
        kind: of.kind,
        id: String(of.id),
        facts: [],
      };
      entry.facts.push(spec);
      factsByReel.set(key, entry);
    } else {
      orphanFacts.push(spec);
    }
  }
  const sortedReels = [...factsByReel.keys()]
    .sort()
    .map((k) => factsByReel.get(k));
  return { sortedReels, orphanFacts };
}

/**
 * Run eager-fold on every reel that received facts. Called by the
 * outer commit boundary (sealFacts or sealAct) AFTER the transaction
 * commits, so projections see the committed state, not in-flight
 * transactional state. Self-healing — failures here are logged and
 * dropped; the next fold round catches up.
 */
export async function foldAfterCommit(sortedReels) {
  try {
    const { fold } = await import("../../present/stamper/2-fold/foldEngine.js");
    // DB-health gate. When the file store became unavailable between the
    // commit and the post-seal fold (most commonly: a long synchronous
    // burst starves the heartbeat), every fold below will fail the
    // same way. The projection is a cache — missed folds just defer to
    // the next read's cold-fold path; nothing breaks, but warning per
    // reel produces a log flood when an act touched many aggregates
    // (a dance-floor plant births 5+ aggregates, so one disconnect
    // produces 5+ warnings on top of any per-tick noise). Skip the
    // batch and log once.
    const { isDbHealthy } = await import("../../seedStory/dbConfig.js");
    if (!isDbHealthy()) {
      _noteFoldDeferredOnce(sortedReels.length);
      return;
    }
    for (const reel of sortedReels) {
      try {
        // History-aware: each reel carries its history from groupByReel
        // (which throws if any spec is missing history). The post-commit
        // fold lands the new state on the history's projection slot,
        // never on main's slot for a non-main reel. No `|| "0"` here —
        // a missing history means upstream broke the invariant and we
        // want it loud, not silently folded onto main.
        // (fold takes the option key `history`; see foldEngine.js.)
        await fold(reel.kind, reel.id, { history: reel.history });
      } catch (err) {
        // Warn (not debug): the projection slot for this reel did NOT
        // materialize. Anyone who SEEs the aggregate next will hit
        // loadOrFold's cold path; if that also fails (or the inner
        // facts have an issue) the user lands at a fallback. We
        // need to see this in dev — silent debug-level masked the
        // "newly registered being lands off-grid" class of bugs.
        log.warn(
          "Fold",
          `post-seal fold failed for ${reel.history}:${reel.kind}:${String(reel.id).slice(0, 8)}: ${err.message}`,
        );
      }
    }
    // afterReelArrival . one batch-level notifier for every reel that
    // received facts in this seal. Reactive inner-face subscriptions
    // (protocols/ibp/innerFaceLive) listen here and refold the subs
    // whose weave indexes any of these reels. Firing ONCE per batch
    // (with the whole reels list) keeps the fan-out O(1) per act;
    // the subscription registry expands the batch internally against
    // its reelKey index and coalesces by subId so one act touching N
    // of a sub's reels triggers ONE refold.
    //
    // Shape of payload.reels: [{ reelKind, reelId, history }]. Mirrors
    // the weave entry shape so the dispatcher can hash directly via
    // reelKey() without renormalizing.
    if (sortedReels.length > 0) {
      try {
        await hooks.run("afterReelArrival", {
          reels: sortedReels.map((r) => ({
            reelKind: r.kind,
            reelId: String(r.id),
            history: r.history,
          })),
        });
      } catch (err) {
        log.warn("Fold", `afterReelArrival fan failed: ${err.message}`);
      }
    }
  } catch (err) {
    log.warn("Fold", `foldAfterCommit unexpected error: ${err.message}`);
  }
}

let _foldDeferredNotedAt = 0;
function _noteFoldDeferredOnce(reelCount) {
  const now = Date.now();
  if (now - _foldDeferredNotedAt > 30000) {
    _foldDeferredNotedAt = now;
    log.warn(
      "Fold",
      `post-seal fold deferred for ${reelCount} reel(s), file store unavailable. The next read on each aggregate will cold-fold from its reel.`,
    );
  }
}

/**
 * Commit a ΔF — the fact-set produced by one act — as one unit.
 *
 * @param {Array<object>} deltaF  array of fact specs (same shape
 *   logFact accepts). For singleton ΔF (most acts today), pass a
 *   single-element array.
 * @param {object} [opts]
 * @param {boolean} [opts.requireTransaction=false] When true, refuse
 *   to commit even singleton ΔF without a replica set (forces the
 *   transactional path). Useful for tests that need to verify the
 *   transaction shape end-to-end.
 *
 * @returns {Promise<{ committed: number, txn: boolean }>}
 *   committed = number of facts in ΔF (post-commit). txn = legacy
 *   transaction flag, always false under the file store.
 */
/**
 * Emit a Fact from inside a verb handler or material helper. The
 * Phase 2 single-entry point: handlers never call logFact directly.
 *
 * Two paths:
 *   - Inside a moment (moment.deltaF exists): synchronously
 *     append the spec to ctx.deltaF. The Fact commits at sealAct
 *     time, atomically with every other Fact the moment emits and
 *     with the Act row.
 *   - Outside a moment (boot, migration, scaffold, standalone tool
 *     paths): commit immediately via sealFacts singleton. Single-
 *     fact ΔF commits atomically without a transaction (logFact's
 *     per-reel lock is enough).
 *
 * This is the boundary the math is about: handlers contribute to
 * ΔF; only the seal commits. Direct logFact calls from handlers
 * are the pre-Phase-2 pattern and must not return.
 *
 * @param {object} spec       fact spec (same shape logFact accepts)
 * @param {object} [moment]  the moment's context, if any
 * @returns {Promise<void>}
 */
export async function emitFact(spec, moment = null) {
  // Stamp foldSeq if the moment recorded a fold for this fact's target
  // reel (PARALLEL FACTS §1.3). Already-set foldSeq wins (callers like
  // verify scripts that author facts manually retain control). Null
  // when the moment didn't fold this reel — null is the correct
  // signal for "no stale-detection key available."
  if (
    spec &&
    spec.foldSeq === undefined &&
    moment?.foldedSeqs instanceof Map &&
    spec.of?.kind &&
    spec.of?.id
  ) {
    const key = `${spec.of.kind}:${spec.of.id}`;
    spec.foldSeq = moment.foldedSeqs.get(key) ?? null;
  }

  // The actor NAME — every fact links DIRECTLY to the name that did it,
  // taken from the moment's act (actorAct.by), never re-resolved per
  // fact. An already-set by wins (manual authors retain control).
  if (spec && spec.by === undefined) {
    spec.by = moment?.actorAct?.by ?? null;
  }

  // Cross-world provenance. When the actor's Act seats on moment
  // and the target's world differs from the actor's world, derive the
  // crossOrigin block and attach it to params. Same-world facts get
  // null and nothing is attached. The Stamper enforces the contract
  // at insert time. See seed/past/act/crossOrigin.js + CROSS-WORLD.md.
  if (moment?.actorAct && spec?.of) {
    const { deriveCrossOrigin } = await import("../act/crossOrigin.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const target = inferTargetWorld(spec, moment, getStoryDomain());
    const crossOrigin = deriveCrossOrigin(moment.actorAct, target);
    if (crossOrigin) {
      spec.params = { ...(spec.params || {}), crossOrigin };
    }
  }

  if (moment && Array.isArray(moment.deltaF)) {
    moment.deltaF.push(spec);
    return;
  }
  // No moment to accumulate into — boot, migration, scaffold, or a
  // standalone tool. Commit as a singleton ΔF (delegates to logFact).
  await sealFacts([spec]);
}

// Resolve the target's world (story + history) from a fact spec.
// The spec carries `history` (where the fact lands); the story is
// ALWAYS this substrate — the local stamper only ever writes local
// reels (cross-story writes travel over canopy and are stamped by
// the receiving substrate). The explicit `of.world` override
// remains for future forwarding shapes.
//
// The story must NOT fall back to actorAct.story: for an inbound
// foreign actor the act's story is the FOREIGN domain, and using it
// here made the target world look foreign too — deriveCrossOrigin
// then compared foreign === foreign and dropped `story` from the
// crossOrigin block (or dropped the whole block when the foreign
// history string matched the local one, e.g. both "0"), losing
// provenance AND the crossOrigin.actId retry-dedupe.
//
// Always operates on ACTUAL history paths, never pointers — pointer
// resolution happens at the address-parsing perimeter before any
// emit. See CROSS-WORLD.md "pointers vs actual histories."
function inferTargetWorld(spec, moment, localStory) {
  if (spec?.of?.world?.story && spec?.of?.world?.history) {
    return { world: spec.of.world };
  }
  const history = spec?.history || moment?.actorAct?.history || null;
  if (!history || !localStory) return null;
  return { world: { story: localStory, history } };
}

export async function sealFacts(deltaF, opts = {}) {
  if (!Array.isArray(deltaF)) {
    throw new Error("sealFacts: deltaF must be an array");
  }
  if (deltaF.length === 0) {
    return { committed: 0, txn: false };
  }

  // FileStore swap: the ΔF commits through logFact, which builds a
  // single-fact commitMoment record and calls fileStore.commitMoment —
  // THE atomic write (WAL frame + fsync under the global commit mutex,
  // then idempotent reel apply). Each fact still rides logFact so its
  // gates (death/banish), the beforeFact hook, payload capping, and
  // cross-origin idempotency all run, exactly as before.
  //
  // The per-reel append lock / multi-document transaction / replica-set
  // requirement are GONE: the commit mutex serializes every write, so a
  // ΔF spanning N reels needs no transaction here. We skip per-fact
  // eager-fold and run foldAfterCommit ONCE over the touched reels (so
  // projections see the committed state). groupByReel both validates
  // history-on-spec and yields the reel set foldAfterCommit folds.
  const { sortedReels, orphanFacts } = groupByReel(deltaF);

  for (const reel of sortedReels) {
    for (const spec of reel.facts) {
      await logFact(spec, { skipEagerFold: true });
    }
  }
  // Orphan (place/stance, target-less) facts have no reel; logFact
  // still commits them as single-fact moments.
  for (const spec of orphanFacts) {
    await logFact(spec, { skipEagerFold: true });
  }

  // Eager-fold AFTER commit. Self-healing on failure.
  if (sortedReels.length > 0) await foldAfterCommit(sortedReels);

  return { committed: deltaF.length, txn: false };
}

function capPayload(value, label) {
  if (value == null) return { value: null, truncated: false };
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { value: { _unserializable: true, _label: label }, truncated: true };
  }
  const max = MAX_PAYLOAD_BYTES();
  if (Buffer.byteLength(serialized, "utf8") <= max) {
    return { value, truncated: false };
  }
  return {
    value: {
      _truncated: true,
      _bytes: Buffer.byteLength(serialized, "utf8"),
      preview: serialized.slice(0, Math.floor(max * 0.9)),
    },
    truncated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

function MAX_QUERY_LIMIT() {
  return Math.max(
    1,
    Math.min(Number(getInternalConfigValue("factQueryLimit")) || 5000, 50000),
  );
}
const MAX_DATE_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

function buildDateFilter(startDate, endDate) {
  const filter = {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;

  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start)
    throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && end - start > MAX_DATE_SPAN_MS) {
    throw new Error("Date range cannot exceed 365 days");
  }

  if (!isNaN(start)) filter.$gte = new Date(start);
  if (!isNaN(end)) filter.$lte = new Date(end);
  return Object.keys(filter).length > 0 ? { date: filter } : {};
}

/**
 * Get the Fact reel for a space.
 * If beingId is provided, verifies the caller has access to the space's tree.
 * Seed-internal callers (hooks, migrations) can omit beingId.
 */
export async function getFacts({
  spaceId,
  limit,
  offset,
  startDate,
  endDate,
  beingId,
  history,
}) {
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  if (beingId) {
    if (typeof history !== "string" || !history) {
      throw new Error(
        "getFacts: history is required when beingId is set (auth walks the chain)",
      );
    }
    const access = await resolveSpaceAccess(spaceId, beingId, history);
    if (!access.ok)
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
  }

  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );
  const safeOffset = Math.max(0, Number(offset) || 0);

  // Read the space reel from its file (own-history; defaults to main
  // when the caller didn't thread a history). Date filter + newest-first
  // ordering + offset/limit apply in JS, matching the curated read
  // semantics.
  const reelHistory =
    typeof history === "string" && history.length ? history : "0";
  const dateFilter = buildDateFilter(startDate, endDate).date;
  const facts = applyReelView(
    fileStore.readReel(reelHistory, "space", String(spaceId)),
    { dateFilter, order: "desc", offset: safeOffset, limit: safeLimit },
  );

  return { facts, limit: safeLimit };
}

// Apply the curated read view (date filter, seq-direction ordering,
// offset/limit) to a raw reel read. Reels come back seq-ascending from
// the file store; "desc" reverses for the explorer's newest-first view.
function applyReelView(reel, { dateFilter = null, order = "desc", offset = 0, limit = 100 } = {}) {
  let rows = reel;
  if (dateFilter) {
    rows = rows.filter((f) => {
      const t = f?.date != null ? Date.parse(f.date) : NaN;
      if (Number.isNaN(t)) return false;
      if (dateFilter.$gte && t < dateFilter.$gte.getTime()) return false;
      if (dateFilter.$lte && t > dateFilter.$lte.getTime()) return false;
      return true;
    });
  }
  // Reel is seq-ascending; desc = newest first.
  rows = order === "asc" ? rows.slice() : rows.slice().reverse();
  return rows.slice(offset, offset + limit);
}

/**
 * Get the reel for any target. Generalizes getFacts beyond space-only.
 * Returns facts targeting (kind, id) ordered newest-first by default
 * (explorer view); pass { order: "asc" } for chain-walk order.
 */
export async function getReel({
  targetKind,
  targetId,
  limit,
  offset,
  order = "desc",
}) {
  if (!targetKind || !targetId) {
    throw new Error("getReel: targetKind and targetId required");
  }
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(
      `getReel: targetKind must be one of ${[...REEL_KINDS].join("|")}`,
    );
  }
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );
  const safeOffset = Math.max(0, Number(offset) || 0);
  // FileStore swap: own-history read (defaults to main). seq-ascending
  // for "asc" chain-walk order; reversed for the "desc" explorer view.
  const facts = applyReelView(
    fileStore.readReel("0", targetKind, String(targetId)),
    { order, offset: safeOffset, limit: safeLimit },
  );
  return { facts, limit: safeLimit, offset: safeOffset };
}

/**
 * Build the reel-explorer descriptor for a (targetKind, targetId).
 * Used by SEE on <story>/.reel/<kind>/<id>. Includes the target's
 * display name (best-effort lookup) and a serialized fact list shaped
 * for the explorer view (full hash chain preserved).
 */
export async function describeReel(targetKind, targetId, opts = {}) {
  const { facts } = await getReel({ targetKind, targetId, ...opts });
  let targetName = null;
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection(targetKind, targetId, "0");
    targetName = slot?.state?.name || null;
  } catch {
    /* name lookup is best-effort */
  }
  return {
    target: { kind: targetKind, id: String(targetId), name: targetName },
    // Redact secrets on the way over the wire — the fact-chain in the DB
    // keeps them, but a reel surfaced to a client must not carry api keys
    // or credentials (they ride in set-being facts' params.value).
    facts: facts.map((f) => redactSecrets(serializeFactForReel(f))),
    count: facts.length,
  };
}

function serializeFactForReel(f) {
  return {
    // The fact's identity IS its content hash; p is the chain link.
    _id: String(f._id),
    seq: f.seq,
    verb: f.verb,
    act: f.act,
    of: f.of,
    params: f.params,
    result: f.result,
    p: f.p,
    date: f.date,
    through: f.through?._id
      ? String(f.through._id)
      : f.through
        ? String(f.through)
        : null,
    beingName: f.through?.name || null,
    actId: f.actId || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CURATED FACT QUERIES — the ONE seam non-chokepoint files call.
//
// Architecture (Tabor: "many can be centralized"): only the chokepoints
// import fileStore directly; everything else calls these wrappers, so the
// storage seam stays in ONE place for the future Rust swap. These wrap the
// fileStore reel-read primitives (readReelWhere / factsByActId) and return the
// plain fact docs callers expect (the .lean() shape). NEVER an external fallback.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The facts one act (moment) laid. Under the one-word doctrine a moment lays
 * ONE fact (multi-fact only at the I-Am root), so this is usually 0..1 — but
 * the read is general. The actor's facts ride the actor's own being-reel, so
 * this reads (history, "being", actorBeingId) and keeps the facts carrying
 * this actId. The file-native read for the facts carrying a given actId.
 *
 * @param {string} history       the reel's history
 * @param {string} actorBeingId  the being whose reel the facts ride
 * @param {string} actId         the act correlation
 * @returns {fact[]}             seq-ascending
 */
export function getFactsByActId(history, actorBeingId, actId) {
  return fileStore.factsByActId(history, actorBeingId, actId);
}

/**
 * Read one reel (history, kind, id) and keep only the facts the predicate
 * accepts, seq-ascending. The curated peer of fileStore.readReelWhere — used
 * by the verb/act/params filters (wordStore's coin/retire reads on I's being
 * reel, etc.) that can't be expressed as a single seq range. The caller writes
 * the predicate; this stays domain-free.
 *
 * @param {string} history
 * @param {"being"|"space"|"matter"|"name"|"library"} kind
 * @param {string} id
 * @param {(fact)=>boolean} predicate
 * @returns {fact[]}  seq-ascending
 */
export function getFactsOnReelWhere(history, kind, id, predicate) {
  return fileStore.readReelWhere(history, kind, String(id), predicate);
}

/**
 * The CROSS-REEL / WORLD fact read — every fact in one history's branch, across
 * all reel-kinds (being·space·matter·name·library) and all authors, kept by a
 * predicate, then sorted. The curated cross-reel read the BOOK (assemble.js)
 * and read-trail.js fold the story from.
 *
 * The curated single-reel readers (getReel / getFactsOnReelWhere / getFactsByActId)
 * read ONE reel by (kind,id); the book is a fold ACROSS reels — facts BY an author
 * ($or through/by) or a SET of authors/objects ($in), facts by actId across reels,
 * a date span, or the whole history. There is no "all facts on a history" file
 * primitive, so this scans every reel of the history (fileStore.listReelKinds +
 * listReelIds → readReel) and applies the caller's predicate + sort in JS. Stays
 * domain-free: the caller (the book) writes which facts it wants and how to order.
 *
 * @param {string} history          the branch to read
 * @param {object} [opts]
 * @param {(fact)=>boolean} [opts.predicate]  keep-filter (default: keep all)
 * @param {(a,b)=>number}   [opts.sort]       comparator (default: by (date,seq))
 * @param {number}          [opts.limit]      cap (0/absent = no cap), applied post-sort
 * @returns {Promise<fact[]>}
 */
export async function getHistoryFacts(history, { predicate, sort, limit } = {}) {
  if (typeof history !== "string" || !history.length) {
    throw new Error("getHistoryFacts: history is required");
  }
  const keep = typeof predicate === "function" ? predicate : () => true;
  const out = [];
  for (const kind of fileStore.listReelKinds(history)) {
    if (!REEL_KINDS.has(kind)) continue;
    for (const id of fileStore.listReelIds(history, kind)) {
      for (const f of fileStore.readReel(history, kind, id)) {
        if (keep(f)) out.push(f);
      }
    }
  }
  const cmp =
    typeof sort === "function"
      ? sort
      : (a, b) => {
          const ad = a?.date != null ? Date.parse(a.date) : 0;
          const bd = b?.date != null ? Date.parse(b.date) : 0;
          if (ad !== bd) return ad - bd;
          return (a?.seq ?? 0) - (b?.seq ?? 0);
        };
  out.sort(cmp);
  return limit && limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Get a being's Fact reel.
 */
export async function getFactsByBeing(beingId, limit, startDate, endDate) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  // The file store organizes facts by TARGET reel (history,kind,id), not
  // by ACTOR. There is no actor-indexed read primitive (a `through`
  // secondary index has no file-store peer), so a being's own facts
  // can't be assembled without scanning every reel. This function has
  // no callers today; the act-log (the being's authored ACTS, via
  // fileStore.readActHeadFile / the .acts chain) is the file-native
  // "what this being did" surface. Return an empty reel rather than a
  // broken read; wire the act-log here if a caller ever needs it.
  void limit;
  void startDate;
  void endDate;
  return { facts: [] };
}
