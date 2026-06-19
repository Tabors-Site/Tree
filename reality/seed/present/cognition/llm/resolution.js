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
// point that wraps it.
//
// THE 7-STEP CHAIN (auth.jpg, plan: graceful-jingling-garden.md)
//
// Walks right-to-left across the IBPA `actor :: receiver`:
//
//   0  receiver being   role-slot list
//   1  receiver being   default list
//   2  receiver space   role-slot + default, walking ancestors
//   3  receiver story role-slot + default
//   3.5 cross-boundary  opens only if forceActor fired upstream
//   4  actor being      role-slot + default
//   5  actor space      role-slot + default, walking ancestors
//   6  actor story    role-slot + default
//
// Each container's `qualities.llm` shape (unified across being, space,
// story):
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
 * @param {object} opts.receiver  { beingId, spaceId, storyDomain }
 * @param {object} [opts.actor]   { beingId, spaceId, storyDomain }
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

