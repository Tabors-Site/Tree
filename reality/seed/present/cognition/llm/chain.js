// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// chain.js — the 7-step LLM resolution chain walker.
//
// The receiving being is about to stamp via cognition. The stamper
// needs ONE connection id (with a fallback chain) to feed the LLM
// client. This file builds that chain by walking right-to-left across
// the IBPA (actor :: receiver):
//
//   Step 0  receiver being   — role-slot list
//   Step 1  receiver being   — default list
//   Step 2  receiver space   — role-slot + default, walking ancestors
//   Step 3  receiver story — role-slot + default
//   Step 3.5 cross-boundary  — opens only if forceActor fired upstream
//   Step 4  actor being      — role-slot + default
//   Step 5  actor space      — role-slot + default, walking ancestors
//   Step 6  actor story    — role-slot + default
//
// Each container exposes a unified `qualities.llm` shape:
//
//   qualities.llm = {
//     default:       string[]     — independent ordered list
//     slots:         { role: string[] } — each role's own independent list
//     preferOwn:     bool         — SOFT: this container's connections jump
//                                   to front WITHIN the step
//     forceActor:    bool         — HARD: chain skips remaining receiver-side,
//                                   jumps to step 4
//     forceReceiver: bool         — HARD: chain caps at this container's step
//   }
//
// Each fallback list is INDEPENDENT. A being with 5 connections under
// `slots["coder"]` and 3 under `default` produces 5+3=8 candidates in
// chain order for role=coder (slot list exhausts before default).
//
// Force-flag walk: closest-to-step-0 wins. The first force flag
// encountered on the receiver-side walk (steps 0..3) determines the
// chain shape. `forceReceiver` caps the chain there; `forceActor` jumps
// to step 4 and continues actor side. Without either, the chain caps
// at step 3 by default (no actor side).
//
// Legacy reads (deprecation window): older containers stored
// `beingLlm.slots`, `beingLlm.preferOwn`, `beingLlm.locked`, and
// `qualities.llm.enforced`. The normalizer below reads both shapes
// and merges them so existing data keeps working until operators
// re-write via the new ops.

import { getAncestorChain } from "../../../materials/space/ancestorCache.js";
import { getStoryConfigValue } from "../../../storyConfig.js";

// ─────────────────────────────────────────────────────────────────────
// CONTAINER NORMALIZER
// ─────────────────────────────────────────────────────────────────────

const SLOT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_CONNECTION_ID_LENGTH = 100;

function toIdList(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    if (item.length === 0 || item.length > MAX_CONNECTION_ID_LENGTH) continue;
    out.push(item);
  }
  return out;
}

function asBool(v) {
  return v === true;
}

function readQualitiesField(qualities, name) {
  if (!qualities) return null;
  return qualities instanceof Map ? qualities.get(name) : qualities[name];
}

/**
 * Read a container's `qualities.llm` into the uniform shape used by
 * the chain walker. Reads legacy `beingLlm` / `enforced` / `locked`
 * so pre-rewire qualities data still resolves.
 *
 * Returns { defaultList, slotList(role), preferOwn, forceActor,
 * forceReceiver }.
 */
export function readContainerLlm(container, role) {
  if (!container) {
    return {
      defaultList: [],
      slotList: [],
      preferOwn: false,
      forceActor: false,
      forceReceiver: false,
    };
  }
  const llm = readQualitiesField(container.qualities, "llm");
  const beingLlm = readQualitiesField(container.qualities, "beingLlm");

  // default list = new `qualities.llm.default[]`.
  const defaultList = toIdList(llm?.default);

  // role-slot list — check new shape first, then legacy `slots` /
  // `beingLlm.slots`. Reject prototype-polluted slot names + invalid
  // patterns.
  let slotList = [];
  if (role && typeof role === "string" && SLOT_NAME_PATTERN.test(role)) {
    const newSlots = llm?.slots;
    if (newSlots && typeof newSlots === "object" && Object.hasOwn(newSlots, role)) {
      slotList = toIdList(newSlots[role]);
    } else if (beingLlm?.slots && typeof beingLlm.slots === "object" && Object.hasOwn(beingLlm.slots, role)) {
      slotList = toIdList(beingLlm.slots[role]);
    }
  }

  // Flags. New container-level flags win; legacy reads merge below.
  let preferOwn = asBool(llm?.preferOwn);
  let forceActor = asBool(llm?.forceActor);
  let forceReceiver = asBool(llm?.forceReceiver);

  // Legacy translations:
  //   beingLlm.preferOwn → llm.preferOwn
  //   llm.enforced       → forceReceiver
  //   beingLlm.locked    → forceReceiver (empty list + cap is the
  //                        legacy "no LLM under me" semantics)
  if (beingLlm?.preferOwn === true) preferOwn = true;
  if (llm?.enforced === true) forceReceiver = true;
  if (beingLlm?.enforced === true) forceReceiver = true;
  if (beingLlm?.locked === true) {
    forceReceiver = true;
    // locked means "no LLM" — empty out lists so the cap produces no
    // candidates. An operator who wrote to qualities.llm.default[]
    // explicitly meant to override the lock; that array survives.
    slotList = [];
  }

  // Mutual exclusion: if a container somehow has both flags set
  // (write-time gate failed or legacy data), forceReceiver wins
  // (conservative — "use my LLM, never reach actor"). New writes
  // refuse this combination upstream.
  if (forceActor && forceReceiver) forceActor = false;

  // Lockout: an empty container with `forceReceiver=true` legacy-locked
  // path produces zero candidates at this step.
  if (beingLlm?.locked === true && defaultList.length === 0) {
    return { defaultList: [], slotList: [], preferOwn, forceActor: false, forceReceiver: true };
  }

  return { defaultList, slotList, preferOwn, forceActor, forceReceiver };
}

// ─────────────────────────────────────────────────────────────────────
// LOAD HELPERS
// ─────────────────────────────────────────────────────────────────────

async function loadBeing(beingId, branch) {
  if (!beingId) return null;
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", beingId, branch).catch(() => null);
  return slot ? { _id: slot.id, ...slot.state } : null;
}

async function loadSpaceAncestors(spaceId, branch) {
  if (!spaceId) return [];
  try {
    return await getAncestorChain(spaceId, branch);
  } catch {
    const { loadOrFold } = await import("../../../materials/projections.js");
    const slot = await loadOrFold("space", spaceId, branch).catch(() => null);
    return slot ? [{ _id: slot.id, ...slot.state }] : [];
  }
}

async function loadStoryRoot(branch) {
  // Story root is the topmost space with parent=null. The ancestor
  // chain for the receiver/actor space ends at it, but for the
  // chain-walker convenience we load it directly so step 3 / 6 don't
  // depend on having walked space ancestors first.
  const { default: Projection } = await import("../../../materials/history/projection.js");
  const row = await Projection.findOne({
    branch, type: "space", "state.parent": null, tombstoned: { $ne: true },
  }).lean();
  if (!row) return null;
  return { _id: row.id, ...row.state };
}

// ─────────────────────────────────────────────────────────────────────
// CHAIN BUILDER
// ─────────────────────────────────────────────────────────────────────

// Append a container's candidates to the chain under a labeled step.
// Returns { added, hitForceReceiver, hitForceActor } so the walker can
// decide what to do next.
function appendContainerCandidates(chain, container, role, step, tried) {
  const norm = readContainerLlm(container, role);
  const ordered = [];

  // slot list first within this container (per the step table).
  for (const id of norm.slotList) {
    if (!tried.has(id)) {
      ordered.push({ step, source: step + ":slot", connectionId: id });
      tried.add(id);
    }
  }
  for (const id of norm.defaultList) {
    if (!tried.has(id)) {
      ordered.push({ step, source: step + ":default", connectionId: id });
      tried.add(id);
    }
  }

  // preferOwn: jump this container's candidates to the front of the
  // chain WITHIN this step. Implementation: append in normal order;
  // the chain order already gives this container priority within the
  // step (since space/story walk happens later). preferOwn is only
  // meaningful when this is a being-level container competing with
  // ancestors at a higher step — but the step structure already gives
  // step 0/1 priority over step 2+. So preferOwn is currently a
  // semantic hook that has no behavior change in the new chain. Kept
  // in the normalizer for back-compat reads and future use.

  for (const entry of ordered) chain.push(entry);

  return {
    added: ordered.length,
    hitForceReceiver: norm.forceReceiver,
    hitForceActor: norm.forceActor,
  };
}

/**
 * Build the ordered LLM connection-id chain for a (actor, receiver,
 * role) triple. Returns:
 *
 *   {
 *     chain: Array<{ step, source, connectionId }>,
 *     tried: Set<string>,                          // already-added connectionIds
 *     reason: string | null,                       // why the walk capped (force flag, no candidates)
 *   }
 *
 * `actor` / `receiver` are `{ beingId, spaceId, storyDomain }`. The
 * storyDomain field is currently informational — same-story is the
 * common case and the resolver walks LOCAL projections regardless.
 */
export async function buildLlmChain({ actor, receiver, role, branch = "0" } = {}) {
  const chain = [];
  const tried = new Set();
  let reason = null;

  // Boundary state. As we walk receiver-side (0..3), the first force
  // flag encountered determines what happens at the 3.5 boundary.
  // forceReceiver caps the chain here; forceActor skips remaining
  // receiver-side and jumps to step 4. Without either, chain caps at 3.
  let boundary = "default-cap-at-3";  // "default-cap-at-3" | "force-receiver" | "force-actor"
  let capStep = null;

  const consumeContainer = async (container, stepLabel, sideIsReceiver) => {
    const before = chain.length;
    const r = appendContainerCandidates(chain, container, role, stepLabel, tried);
    // On receiver-side: act on force flags. On actor-side: forceReceiver
    // caps the actor sub-walk, forceActor is a no-op.
    if (sideIsReceiver) {
      if (r.hitForceReceiver) {
        boundary = "force-receiver";
        capStep = stepLabel;
        return { capped: true };
      }
      if (r.hitForceActor) {
        boundary = "force-actor";
        capStep = stepLabel;
        return { capped: true };
      }
    } else {
      if (r.hitForceReceiver) {
        capStep = stepLabel;
        return { capped: true };
      }
    }
    return { capped: false, added: chain.length - before };
  };

  // ── RECEIVER SIDE ──

  const receiverBeing = await loadBeing(receiver?.beingId, branch);

  // Step 0/1: receiver being (slot list, then default list, in one
  // container-read — the step number on each entry preserves the
  // 0-vs-1 distinction for forensics).
  if (receiverBeing) {
    const before = chain.length;
    const norm = readContainerLlm(receiverBeing, role);
    for (const id of norm.slotList) {
      if (!tried.has(id)) {
        chain.push({ step: "0", source: "receiver-being:slot", connectionId: id });
        tried.add(id);
      }
    }
    for (const id of norm.defaultList) {
      if (!tried.has(id)) {
        chain.push({ step: "1", source: "receiver-being:default", connectionId: id });
        tried.add(id);
      }
    }
    if (norm.forceReceiver) {
      boundary = "force-receiver";
      capStep = "1";
      return { chain, tried, reason: "forceReceiver on receiver being (capped at step 1)" };
    }
    if (norm.forceActor) {
      boundary = "force-actor";
      capStep = "1";
      // skip steps 2 and 3, jump straight to actor side
    }
  }

  // Step 2: receiver space ancestors (only if not jumping to actor).
  if (boundary !== "force-actor" && receiver?.spaceId) {
    const ancestors = await loadSpaceAncestors(receiver.spaceId, branch);
    for (const space of ancestors) {
      const norm = readContainerLlm(space, role);
      for (const id of norm.slotList) {
        if (!tried.has(id)) {
          chain.push({ step: "2", source: "receiver-space:slot", connectionId: id });
          tried.add(id);
        }
      }
      for (const id of norm.defaultList) {
        if (!tried.has(id)) {
          chain.push({ step: "2", source: "receiver-space:default", connectionId: id });
          tried.add(id);
        }
      }
      if (norm.forceReceiver) {
        boundary = "force-receiver";
        capStep = "2";
        return { chain, tried, reason: "forceReceiver on receiver space (capped at step 2)" };
      }
      if (norm.forceActor) {
        boundary = "force-actor";
        capStep = "2";
        break;  // skip remaining space ancestors + step 3, jump to actor side
      }
    }
  }

  // Step 3: receiver story root.
  if (boundary !== "force-actor") {
    const storyRoot = await loadStoryRoot(branch);
    if (storyRoot) {
      const norm = readContainerLlm(storyRoot, role);
      for (const id of norm.slotList) {
        if (!tried.has(id)) {
          chain.push({ step: "3", source: "receiver-story:slot", connectionId: id });
          tried.add(id);
        }
      }
      for (const id of norm.defaultList) {
        if (!tried.has(id)) {
          chain.push({ step: "3", source: "receiver-story:default", connectionId: id });
          tried.add(id);
        }
      }
      // Story-config back-compat: read storyLlmConnection if no
      // qualities.llm.default exists at story root.
      if (norm.defaultList.length === 0 && norm.slotList.length === 0) {
        const configConn = getStoryConfigValue("storyLlmConnection");
        if (configConn && !tried.has(configConn)) {
          chain.push({ step: "3", source: "receiver-story:config", connectionId: configConn });
          tried.add(configConn);
        }
      }
      if (norm.forceReceiver) {
        boundary = "force-receiver";
        capStep = "3";
        return { chain, tried, reason: "forceReceiver on receiver story (capped at step 3)" };
      }
      if (norm.forceActor) {
        boundary = "force-actor";
        capStep = "3";
      }
    }
  }

  // ── 3.5 GATE ──
  // Continue to actor side only if forceActor was set somewhere on
  // receiver side. Default behavior: chain caps at step 3.
  if (boundary !== "force-actor") {
    reason = chain.length > 0
      ? "chain capped at step 3 (default; no forceActor on receiver side)"
      : "no receiver-side candidates and no forceActor — chain empty";
    return { chain, tried, reason };
  }

  // ── ACTOR SIDE ──

  if (!actor?.beingId && !actor?.spaceId) {
    reason = "forceActor fired but no actor context to walk";
    return { chain, tried, reason };
  }

  // Step 4: actor being.
  const actorBeing = await loadBeing(actor?.beingId, branch);
  if (actorBeing) {
    const norm = readContainerLlm(actorBeing, role);
    for (const id of norm.slotList) {
      if (!tried.has(id)) {
        chain.push({ step: "4", source: "actor-being:slot", connectionId: id });
        tried.add(id);
      }
    }
    for (const id of norm.defaultList) {
      if (!tried.has(id)) {
        chain.push({ step: "4", source: "actor-being:default", connectionId: id });
        tried.add(id);
      }
    }
    if (norm.forceReceiver) {
      reason = "forceReceiver on actor being (caps actor walk at step 4)";
      return { chain, tried, reason };
    }
  }

  // Step 5: actor space ancestors.
  if (actor?.spaceId) {
    const ancestors = await loadSpaceAncestors(actor.spaceId, branch);
    for (const space of ancestors) {
      const norm = readContainerLlm(space, role);
      for (const id of norm.slotList) {
        if (!tried.has(id)) {
          chain.push({ step: "5", source: "actor-space:slot", connectionId: id });
          tried.add(id);
        }
      }
      for (const id of norm.defaultList) {
        if (!tried.has(id)) {
          chain.push({ step: "5", source: "actor-space:default", connectionId: id });
          tried.add(id);
        }
      }
      if (norm.forceReceiver) {
        reason = "forceReceiver on actor space (caps actor walk at step 5)";
        return { chain, tried, reason };
      }
    }
  }

  // Step 6: actor story (currently same as receiver story for
  // same-story calls; the chain de-duplicates via `tried`).
  if (!actor?.storyDomain || actor.storyDomain === receiver?.storyDomain) {
    // Same story — the receiver story root already contributed.
    // Try the same root again under step 6 only if something new
    // appeared (rare, but covers operator edits between walks).
    const storyRoot = await loadStoryRoot(branch);
    if (storyRoot) {
      const norm = readContainerLlm(storyRoot, role);
      for (const id of norm.slotList) {
        if (!tried.has(id)) {
          chain.push({ step: "6", source: "actor-story:slot", connectionId: id });
          tried.add(id);
        }
      }
      for (const id of norm.defaultList) {
        if (!tried.has(id)) {
          chain.push({ step: "6", source: "actor-story:default", connectionId: id });
          tried.add(id);
        }
      }
    }
  } else {
    // Cross-world: actor story is foreign. The locally-cached
    // projection (if any) would live somewhere outside the standard
    // story root. For now we don't have foreign-story projections
    // wired in; step 6 contributes nothing for cross-world actors.
    // This is documented in the plan as a follow-up.
  }

  if (chain.length === 0) {
    reason = "chain exhausted with no candidates anywhere";
  }
  return { chain, tried, reason };
}
