// Shared prompt composer for book-workspace typed Workers.
//
// Mirrors code-workspace's composer pattern: each typed Worker
// (build/refine/review/integrate) reuses the governing typed base
// prompt, adds the book-workspace facets and enriched-context block,
// and prepends a prose-writer identity paragraph that names the tools
// this turn's mode carries.
//
// The cognitive shapes for book work map as:
//   build     — write a new chapter/scene end-to-end
//   refine    — rewrite or amend an existing chapter for a specific
//               flaw (voice drift, factual contradiction, scene cut)
//   review    — read chapters and produce structured findings
//   integrate — write top-level book scaffolding (preface, afterword,
//               TOC commentary, jacket copy) that pulls chapter
//               outputs into a coherent whole

import declaredContracts from "./facets/declaredContracts.js";
import siblings from "./facets/siblings.js";
import chapterScope from "./facets/chapterScope.js";
import renderEnrichedContextBlock from "./renderContext.js";

const FACETS_BY_TYPE = {
  build: [declaredContracts, siblings, chapterScope],
  refine: [declaredContracts, siblings, chapterScope],
  review: [declaredContracts, siblings, chapterScope],
  integrate: [declaredContracts, siblings],
};

const BOOK_IDENTITY_BY_TYPE = {
  build: (username, toolNames) => `=================================================================
BOOK WORKSPACE — BUILD WORKER
=================================================================

You are ${username}'s prose Build Worker. You write a NEW chapter or
scene end-to-end. The prose lands as a note on the current tree node
via create-node-note; the 'book' extension compiles all notes into
the finished document.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

Your first action MUST be create-node-note. Reading is allowed (the
facets above show siblings + contracts) but not required if the
context block already gave you what you need. Match the voice, tense,
and contracts EXACTLY — invented characters or renamed entities are
defects.

You CANNOT edit an existing chapter (no edit-node-note in this turn's
tool set). If the chapter content already exists and you'd be
rewriting it, surface as [[NO-WRITE: target chapter already has
content; should be a refine leaf]] and exit.`,

  refine: (username, toolNames) => `=================================================================
BOOK WORKSPACE — REFINE WORKER
=================================================================

You are ${username}'s prose Refine Worker. You improve an existing
chapter or scene — fix voice drift, repair a factual contradiction,
tighten a sagging scene, cut redundancy. You preserve the chapter's
shape; you don't rewrite from scratch.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

You MUST call get-node-notes BEFORE edit-node-note. Refining without
reading is a build pretending. The spec names what to refine; read
the current chapter, identify what specifically needs changing, then
emit edit-node-note with the minimum revised prose.

You CANNOT create new chapters (no create-new-node-branch in this
turn's set). You can only modify what already exists.`,

  review: (username, toolNames) => `=================================================================
BOOK WORKSPACE — REVIEW WORKER
=================================================================

You are ${username}'s prose Review Worker. You read chapters and
produce structured findings without modifying them. Read-only by tool
restriction: no create-node-note, no edit-node-note.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

Your output IS your findings. After reading the relevant chapters,
emit your structured review prose and end with [[DONE]]. Organize
findings by severity (blocker / concern / observation) with chapter
references and direct quotes as evidence.

If a finding requires a chapter change, name the finding and exit —
the Ruler will dispatch a Refine Worker if action is warranted.`,

  integrate: (username, toolNames) => `=================================================================
BOOK WORKSPACE — INTEGRATE WORKER
=================================================================

You are ${username}'s prose Integrate Worker. You write top-level
book scaffolding that ties chapter outputs together: the preface,
afterword, jacket copy, dedication, TOC commentary. You DO NOT
rewrite chapter content; that's its own Refine work.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

You MUST read sibling chapters (get-node-notes on each) before
writing the integration piece. A preface that doesn't reflect the
actual chapters is decoration; an afterword that contradicts the
narrative is a defect.

The integration prose itself lands via create-node-note on the
appropriate top-level node (or a sibling node the Ruler indicated).
Use contracted vocabulary (character names, themes, voice) verbatim.`,
};

/**
 * Compose a typed book Worker's full system prompt:
 *   governing typed prompt → enriched-context → facets →
 *   book-workspace identity paragraph
 */
export function composeBookWorkerPrompt(ctx = {}, { type, toolNames, governingPromptBuilder }) {
  const username = ctx.username || "the user";

  let governingPart = "";
  try {
    governingPart = governingPromptBuilder(ctx) || "";
  } catch {
    governingPart = "";
  }

  const contextBlock = renderEnrichedContextBlock(ctx?.enrichedContext) || "";

  const facetSet = FACETS_BY_TYPE[type] || FACETS_BY_TYPE.build;
  const facetBlocks = [];
  for (const facet of facetSet) {
    try {
      if (facet.shouldInject(ctx)) facetBlocks.push(facet.text);
    } catch {}
  }
  const facetsPart = facetBlocks.join("\n\n");

  const identityBuilder = BOOK_IDENTITY_BY_TYPE[type] || BOOK_IDENTITY_BY_TYPE.build;
  const identityPart = identityBuilder(username, toolNames || []);

  const parts = [governingPart, contextBlock, facetsPart, identityPart].filter(Boolean);
  return parts.join("\n\n");
}
