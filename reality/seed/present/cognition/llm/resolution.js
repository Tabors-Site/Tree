// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// resolution.js — the LLM connection resolver entry point.
//
// At the end of the day, this just chooses what LLM connection id to
// use when the receiving being is about to stamp via cognition. The
// stamper passes that id into the LLM client; the client calls; the
// result becomes the act's content.
//
// The chain walker lives in `chain.js`. This file is the public entry
// point that wraps it and the back-compat shims for existing callers.
//
// THE 7-STEP CHAIN (auth.jpg, plan: graceful-jingling-garden.md)
//
// Walks right-to-left across the IBPA `actor :: receiver`:
//
//   0  receiver being   role-slot list
//   1  receiver being   default list
//   2  receiver space   role-slot + default, walking ancestors
//   3  receiver reality role-slot + default
//   3.5 cross-boundary  opens only if forceActor fired upstream
//   4  actor being      role-slot + default
//   5  actor space      role-slot + default, walking ancestors
//   6  actor reality    role-slot + default
//
// Each container's `qualities.llm` shape (unified across being, space,
// reality):
//
//   qualities.llm = {
//     default:       string[],    // independent ordered list
//     slots:         { role: string[] },  // each role's own list
//     preferOwn:     bool,
//     forceActor:    bool,        // skip remaining receiver-side
//     forceReceiver: bool,        // cap chain at this container's step
//   }
//
// Independent lists: a being with 5 connections under slots["coder"]
// and 3 under default produces 5+3=8 candidates for role=coder. Each
// list exhausts independently.
//
// Force flags: closest-to-step-0 wins. forceReceiver caps the chain;
// forceActor crosses the 3.5 boundary.

import { buildLlmChain } from "./chain.js";

/**
 * Build the LLM connection chain for a receiver+actor+role triple.
 * Returns the ordered candidate list; the stamper's failover loop
 * drains it.
 *
 * @param {object} opts
 * @param {object} opts.receiver  { beingId, spaceId, realityDomain }
 * @param {object} [opts.actor]   { beingId, spaceId, realityDomain }
 *                                (null/missing — no actor side walked)
 * @param {string} [opts.role]    role name for per-role slot lookups
 * @param {string} [opts.branch]  branch id (default "0")
 * @returns {Promise<{ chain, tried, reason }>}
 */
export async function resolveLlmConnectionChain({
  actor = null,
  receiver = null,
  role = null,
  branch = "0",
} = {}) {
  return buildLlmChain({ actor, receiver, role, branch });
}

/**
 * Back-compat shim. Old callers asked for a single connection id at a
 * (being, space, slot) triple — no actor context. The new chain
 * accepts the same inputs as a "receiver-only" call and returns the
 * first candidate.
 *
 * Returns the chosen connection id or null.
 */
export async function resolveLlmConnection({
  beingId = null,
  spaceId = null,
  slot = "main",
  branch = "0",
} = {}) {
  const { chain } = await buildLlmChain({
    receiver: { beingId, spaceId, realityDomain: null },
    actor: null,
    role: slot,
    branch,
  });
  return chain.length > 0 ? chain[0].connectionId : null;
}

/**
 * Back-compat shim. `resolveRootLlmForRole` was the LLM-assigner's
 * thin wrapper over `resolveLlmConnection` taking a root id + role
 * spec. The new chain walks the same inputs and returns the first
 * candidate.
 *
 * @deprecated Use `resolveLlmConnectionChain` directly.
 */
export async function resolveRootLlmForRole(rootId, role) {
  if (!rootId) return null;
  return resolveLlmConnection({
    spaceId: rootId,
    slot: role?.llmSlot || role?.name || "main",
  });
}
