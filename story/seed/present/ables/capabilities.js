// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// capabilities.js . cognition-agnostic capability resolution.
//
// A able declares what it is licensed to dispatch across the three
// act-capable verbs via canDo / canSummon / canBe. Some entries are
// concrete strings; some are descriptor objects ({name, description});
// some are relationship tokens ({rel: "parent"}, {pattern: "<glob>"},
// {resolver: "<key>"}) that expand per-moment-per-being through the
// canStarResolver registry.
//
// `resolveBareCapabilities` runs the same resolver path the LLM
// cognition's prompt builder uses (assemble.js's renderVocabularyAsWord)
// but returns bare-name string lists instead of the rendered Word
// vocabulary. This is what the kernel consumes when building an
// innerFace . it doesn't care HOW the LLM rendered the menu, only
// WHAT the being was licensed to dispatch at the moment.
//
// Lives in present/ables/ because the able spec is where can* lists
// originate; cognition modules (cognition/llm/, future scripted /
// human cognitions) all consume from here. Moving this out of the LLM
// module restores the dependency direction — cognitions depend on
// ables, never the reverse.

import { resolveCanStar } from "./canStarResolver.js";

/**
 * Resolve the able's three act-capable can* lists down to bare name
 * strings, suitable for innerFace capture or any other
 * cognition-agnostic introspection of "what was the being licensed
 * to dispatch this moment?"
 *
 * Returns { canDo, canSummon, canBe } — three string arrays. Empty
 * arrays for an empty / missing list, never null.
 *
 * @param {object} able  the able spec (from registry, possibly composed)
 * @param {object} ctx   { being, currentSpace, rootId, name } — what the
 *                       canStar resolvers need to expand relationship tokens
 */
export async function resolveBareCapabilities(able, ctx) {
  if (!able) return { canDo: [], canSummon: [], canBe: [] };
  const beingCtx = {
    being: ctx?.being || null,
    able,
    currentSpace: ctx?.currentSpace || null,
    rootId: ctx?.rootId || null,
    name: ctx?.name || null,
  };
  // canSummon entries are two-sided: `as: "actor"` (default) is
  // caller-side (what this able can SEND); `as: "receiver"` is
  // receive-side (what this able accepts when TARGETED). The
  // resolved capabilities here drive the LLM frame's tool palette,
  // act-chain face snapshots, and any other "what this able can
  // INITIATE" surface — so only actor entries belong. Receiver
  // entries surface elsewhere (UI discovery, the receiver's own
  // cognition). See seed/AblesAreAuth.md "canSummon: one field, two
  // surfaces."
  const actorSummonEntries = Array.isArray(able.canSummon)
    ? able.canSummon.filter(
        (e) => typeof e !== "object" || (e?.as ?? "actor") === "actor",
      )
    : null;
  const [doEntries, summonEntries, beEntries] = await Promise.all([
    resolveCanStar(able.canDo, beingCtx),
    resolveCanStar(actorSummonEntries, beingCtx),
    resolveCanStar(able.canBe, beingCtx),
  ]);
  const toNames = list =>
    list.map(e => (typeof e === "string" ? e : e?.name || null)).filter(Boolean);
  return {
    canDo:     toNames(doEntries),
    canSummon: toNames(summonEntries),
    canBe:     toNames(beEntries),
  };
}
