// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedResolvers.js — the foundational can* resolvers shipped by seed.
//
// canStarResolver.js is the expansion layer. Ables declare capabilities
// relationally (`{rel: "mother"}`, `{pattern: "@coder*", patternKind:
// "glob"}`) and the layer resolves them to concrete entries at
// frame-time per being. This file registers the seed's foundational
// resolvers; extensions register their own via the same registerRel /
// registerPattern / registerNamed surface.
//
// Seed-shipped resolvers:
//
//   rel: "parent"        → being-tree parent (parentBeingId)
//   rel: "mother"        → qualities.lineage.mother
//   rel: "father"        → qualities.lineage.father
//   pattern + glob       → name-prefix / suffix-wildcard matching across beings
//
// All resolvers return either an empty array (no match → entry drops
// from the frame) or an array of self-describing `{pattern: "@<name>",
// description}` entries. Consumers (the LLM frame builder, descriptor
// actions) treat them as literals after expansion — no further walk.

import log from "../../seedStory/log.js";
import {
  registerRelResolver,
  registerPatternResolver,
} from "./canStarResolver.js";

// ────────────────────────────────────────────────────────────────────
// rel: "parent" — the being-tree parent
// ────────────────────────────────────────────────────────────────────

registerRelResolver("parent", async (entry, beingCtx) => {
  const parentId = beingCtx?.toBeing?.parentBeingId;
  if (!parentId) return [];
  const parent = await loadBeingById(parentId);
  if (!parent) return [];
  return [{
    pattern:     `@${parent.name}`,
    description: entry?.description || `your being-tree parent (@${parent.name})`,
    intent:      entry?.intent,
  }];
});

// ────────────────────────────────────────────────────────────────────
// rel: "mother" / "father" — lineage record
// ────────────────────────────────────────────────────────────────────

registerRelResolver("mother", async (entry, beingCtx) => {
  return await resolveLineageParent(entry, beingCtx, "mother");
});

registerRelResolver("father", async (entry, beingCtx) => {
  return await resolveLineageParent(entry, beingCtx, "father");
});

async function resolveLineageParent(entry, beingCtx, able) {
  const qualities = beingCtx?.toBeing?.qualities;
  const lineage =
    qualities instanceof Map ? qualities.get("lineage") : qualities?.lineage;
  const parentId = lineage?.[able];
  if (!parentId) return [];
  const parent = await loadBeingById(parentId);
  if (!parent) return [];
  return [{
    pattern:     `@${parent.name}`,
    description: entry?.description || `your ${able} (@${parent.name})`,
    intent:      entry?.intent,
  }];
}

// ────────────────────────────────────────────────────────────────────
// pattern + patternKind: "glob" — name-prefix / suffix wildcards
// ────────────────────────────────────────────────────────────────────
//
// Supported wildcards:
//   "@coder"     — exact name match (no wildcard)
//   "@coder*"    — name starts with "coder"
//   "@*coder"    — name ends with "coder"
//   "@*coder*"   — name contains "coder"
//   "@*"         — any name (all beings)

registerPatternResolver("glob", async (entry, _beingCtx) => {
  const pat = entry?.pattern;
  if (typeof pat !== "string" || !pat.length) return [];
  const stripped = pat.startsWith("@") ? pat.slice(1) : pat;
  const matcher  = buildGlobMatcher(stripped);
  if (!matcher) return [];
  const names = await listMatchingBeingNames(matcher);
  return names.map((name) => ({
    pattern:     `@${name}`,
    description: entry?.description || `@${name}`,
    intent:      entry?.intent,
  }));
});

function buildGlobMatcher(stripped) {
  const startsWithStar = stripped.startsWith("*");
  const endsWithStar   = stripped.endsWith("*");
  const core = stripped.replace(/^\*+|\*+$/g, "");
  if (startsWithStar && endsWithStar) return (n) => n.includes(core);
  if (startsWithStar)                 return (n) => n.endsWith(core);
  if (endsWithStar)                   return (n) => n.startsWith(core);
  if (core.length > 0)                return (n) => n === core;
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function loadBeingById(beingId) {
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", String(beingId), "0");
    if (!slot?.state) return null;
    return { _id: slot.id, name: slot.state.name, ...slot.state };
  } catch (err) {
    log.debug("SeedResolvers", `loadBeingById(${beingId}) failed: ${err.message}`);
    return null;
  }
}

async function listMatchingBeingNames(matcher) {
  try {
    // Curated read: list every being in main (history "0") via the
    // projections facade, batch-load their slots, and apply the glob
    // matcher to each name. Same scope as the prior raw query over
    // projection _ids `^0:being:` (own-history main, live slots) — the
    // facade's listByType / loadProjections already exclude tombstones.
    const { listByType, loadProjections } =
      await import("../../materials/projections.js");
    const occupants = await listByType("being", "0");
    const ids = occupants.map((o) => o.id);
    const slots = await loadProjections("being", ids, "0");
    const out = [];
    for (const slot of slots.values()) {
      const name = slot?.state?.name;
      if (typeof name === "string" && matcher(name)) out.push(name);
    }
    return out;
  } catch (err) {
    log.debug("SeedResolvers", `glob list failed: ${err.message}`);
    return [];
  }
}
