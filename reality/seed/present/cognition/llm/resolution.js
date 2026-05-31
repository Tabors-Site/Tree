// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// resolution.js — the LLM connection chain walk.
//
// Resolution philosophy: position-first, identity-last. *Where* you
// are shapes your tools more than *who* you are — until you say
// otherwise.
//
// Four layers of authority, evaluated top-down:
//
//   Layer 1 — Lockout (sovereign over everything):
//     ANY ancestor in the space walk has `llmDefault === "none"`, OR
//     ANY ancestor in the being walk has `beingLlm.locked === true`
//     → returns null. "No LLM under this scope, period."
//
//   Layer 2 — Enforcement (sovereign over preferOwn):
//     ANY ancestor in the space walk has `qualities.llm.enforced === true`
//     → use that space's connection. Position locks the LLM in.
//
//     ANY ancestor in the being walk has `beingLlm.enforced === true`
//     → use that being's connection. Parent being locks descendants in.
//
//     When both apply, space enforcement wins (position > identity).
//
//   Layer 3 — Default chain (substrate model; the common case):
//     1. space.qualities.llm.slots[slot]  ← role-LLM at this exact position
//     2. space.llmDefault                 ← default LLM at this position
//     3. walk to parent, repeat 1+2
//     4. ... up to place root ...
//     5. place config: realityLlmConnection  ← operator fallback for the place
//     6. being.qualities.beingLlm.slots[slot] ← being's role-specific LLM
//     7. being.llmDefault                 ← being's "personal" default
//
//   Layer 3′ — Being-preferred chain (user opts in):
//     When `being.qualities.beingLlm.preferOwn === true` AND no
//     enforcement was found, the order inverts: being's LLM ranks
//     above position. Lockout still applies; enforcement still wins
//     over preferOwn.
//
//   Layer 4 — Per-call override (programmatic):
//     Caller passes a connectionId directly into `getClientForBeing`
//     instead of letting it resolve. Tests, special-case dispatch.
//
// This file owns the walk + the four-layer logic. The slot-rule
// readers (`getSpaceLlmAssignments`, `getBeingLlmAssignments`) live
// in connect.js because they're the projection from the qualities
// shape; resolution imports them.

import Being from "../../../materials/being/being.js";
import Space from "../../../materials/space/space.js";
import { getAncestorChain } from "../../../materials/space/ancestorCache.js";
import { getRealityConfigValue } from "../../../realityConfig.js";
import {
  getSpaceLlmAssignments,
  getBeingLlmAssignments,
} from "./connect.js";

const BEING_CHAIN_MAX_DEPTH = 20;
const LOCKDOWN = Symbol("LOCKDOWN");

/**
 * Walk `being.parentBeingId` up to root, collecting beings as we go.
 * Cycle-guarded + depth-capped. Returns an array starting with the
 * passed-in being and ending at the chain root.
 */
async function walkBeingChain(rootBeing) {
  if (!rootBeing) return [];
  const chain = [rootBeing];
  const seen = new Set([String(rootBeing._id)]);
  let curId = rootBeing.parentBeingId || null;
  let depth = 0;
  while (curId && depth < BEING_CHAIN_MAX_DEPTH) {
    const id = String(curId);
    if (seen.has(id)) break;
    seen.add(id);
    const parent = await Being.findById(id)
      .select("llmDefault qualities parentBeingId")
      .lean()
      .catch(() => null);
    if (!parent) break;
    chain.push(parent);
    curId = parent.parentBeingId || null;
    depth++;
  }
  return chain;
}

/**
 * Walk the space ancestor chain looking for: a lockout, an enforced
 * connection, or a normal hit. Returns LOCKDOWN sentinel on lock,
 * { connectionId, enforced } on hit, null when no candidate found.
 */
async function spaceChainResolve(spaceId, slot) {
  if (!spaceId) return null;
  let chain;
  try {
    chain = await getAncestorChain(spaceId);
  } catch {
    const single = await Space.findById(spaceId)
      .select("llmDefault qualities")
      .lean();
    chain = single ? [single] : [];
  }
  let firstHit = null;
  for (const space of chain) {
    const a = getSpaceLlmAssignments(space);
    if (a.default === "none") return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.default;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.default;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

/**
 * Walk the being ancestor chain (pre-loaded) looking for lockout,
 * enforcement, or a normal hit.
 */
function beingChainResolve(beingChain, slot) {
  if (!beingChain.length) return null;
  let firstHit = null;
  for (const being of beingChain) {
    const a = getBeingLlmAssignments(being);
    if (a.locked) return LOCKDOWN;
    if (a.enforced) {
      const hit = a[slot] || a.main;
      if (hit) return { connectionId: hit, enforced: true };
    }
    if (!firstHit) {
      const hit = a[slot] || a.main;
      if (hit) firstHit = { connectionId: hit, enforced: false };
    }
  }
  return firstHit;
}

/**
 * Resolve the LLM connectionId for a call at a specific position by
 * a specific being. Walks the four-layer chain above. Returns the
 * resolved connectionId string, or null when no connection applies
 * (lockout, or no candidate anywhere on the chain).
 */
export async function resolveLlmConnection({
  beingId = null,
  spaceId = null,
  slot = "main",
} = {}) {
  const being = beingId
    ? await Being.findById(beingId)
        .select("llmDefault qualities parentBeingId")
        .lean()
        .catch(() => null)
    : null;
  const beingChain = await walkBeingChain(being);

  const spaceHit = await spaceChainResolve(spaceId, slot);
  const beingHit = beingChainResolve(beingChain, slot);

  // Layer 1: Lockout wins over everything.
  if (spaceHit === LOCKDOWN || beingHit === LOCKDOWN) return null;

  // Layer 2: Enforcement wins over preferOwn. Space enforcement beats
  // being enforcement when both apply (position-first philosophy).
  if (spaceHit?.enforced) return spaceHit.connectionId;
  if (beingHit?.enforced) return beingHit.connectionId;

  // Layer 3 / 3′: normal chain. preferOwn (set on the calling being's
  // own qualities) inverts the order.
  const preferOwn = being?.qualities?.beingLlm?.preferOwn === true;
  const realityConnId = getRealityConfigValue("realityLlmConnection") || null;
  const candidates = preferOwn
    ? [beingHit?.connectionId, spaceHit?.connectionId, realityConnId]
    : [spaceHit?.connectionId, realityConnId, beingHit?.connectionId];

  for (const c of candidates) if (c) return c;
  return null;
}

/**
 * @deprecated Use `resolveLlmConnection({ beingId, spaceId, slot })` instead.
 * Kept as a thin shim for legacy callers that pass a `role` spec and only
 * have the tree root.
 */
export async function resolveRootLlmForRole(rootId, role) {
  if (!rootId) return null;
  return resolveLlmConnection({
    spaceId: rootId,
    slot: role?.llmSlot || "main",
  });
}
