// Shared prompt composer for code-workspace typed Workers.
//
// Each typed Worker (build/refine/review/integrate) reuses:
//   • the governing typed mode's base prompt (parent contracts +
//     lineage + plan + type-specific body)
//   • the workspace's enriched-context block (local tree view,
//     position breadcrumb, perspective filter)
//   • a curated subset of code-workspace facets relevant to the type
//   • a code-specific augmentation paragraph naming the JS-builder
//     identity and the workspace tools available for this type
//
// This file owns the composition; each mode file owns its type
// selection + tool list.

import behavioralTest from "./facets/behavioralTest.js";
import probeLoop from "./facets/probeLoop.js";
import rewriteOverEdits from "./facets/rewriteOverEdits.js";
import nodePlan from "./facets/nodePlan.js";
import blockingError from "./facets/blockingError.js";
import declaredContracts from "./facets/declaredContracts.js";
import siblings from "./facets/siblings.js";
import renderEnrichedContextBlock from "./renderContext.js";
import { buildStrategyContextBlock } from "../strategyRegistry.js";

// Facet sets per worker type. Each facet decides via its own
// shouldInject(ctx); the per-type set just picks which facets are
// allowed to contribute at all for this cognitive shape.
//
// Build / Integrate are creating artifacts — they need the contract
// declaration, sibling visibility, blockingError catch, behavioral
// tests, probe loop, nodePlan.
//
// Refine is improving existing files — same set plus rewriteOverEdits
// (catches "AI keeps rewriting the same file" anti-pattern).
//
// Review is read-only — facets that drive writes (rewriteOverEdits,
// probeLoop, behavioralTest) are skipped; the Review Worker reads
// contracts + siblings + nodePlan to know what it's judging.
const FACETS_BY_TYPE = {
  build: [
    blockingError,
    declaredContracts,
    siblings,
    nodePlan,
    behavioralTest,
    probeLoop,
  ],
  refine: [
    blockingError,
    declaredContracts,
    siblings,
    nodePlan,
    behavioralTest,
    probeLoop,
    rewriteOverEdits,
  ],
  review: [
    blockingError,
    declaredContracts,
    siblings,
    nodePlan,
  ],
  integrate: [
    blockingError,
    declaredContracts,
    siblings,
    nodePlan,
    probeLoop,
  ],
};

// Type-specific code-workspace identity / framing paragraph. The
// governing typed mode's prompt already has the cognitive-shape body;
// this adds the code-builder identity and names the tool list the
// Worker is actually carrying so the model sees its tools enumerated
// at prompt-time rather than discovering them through trial calls.
const CODE_IDENTITY_BY_TYPE = {
  build: (username, toolNames) => `=================================================================
CODE WORKSPACE — BUILD WORKER
=================================================================

You are a JavaScript Build Worker. Your writes land as real files
on disk via the workspace tools below. Never reply with code in
chat — call workspace-add-file with the content.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

You CANNOT edit existing files (no workspace-edit-file). You CANNOT
delete files (no workspace-delete-file). Build is for new artifacts.
If you find yourself wanting to change an existing file, the leaf was
mistyped — surface it as [[NO-WRITE: leaf appears to be a refine, not
a build: <which file exists>]] and exit.`,

  refine: (username, toolNames) => `=================================================================
CODE WORKSPACE — REFINE WORKER
=================================================================

You are a JavaScript Refine Worker. You improve existing files.
Read first, then change minimally.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

You MUST call workspace-read-file on the target file BEFORE
workspace-edit-file. A refine that starts by writing is a build
pretending. If the target file doesn't exist, surface as [[NO-WRITE:
refine target missing: <path>]] and exit — don't create it
(that's a Build leaf).

You CANNOT add new files (no workspace-add-file). Refine is for
artifacts that already exist.`,

  review: (username, toolNames) => `=================================================================
CODE WORKSPACE — REVIEW WORKER
=================================================================

You are a JavaScript Review Worker. You read, judge, and report
findings. You do NOT modify any code or workspace file.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

Notice what is NOT in your tools: workspace-add-file,
workspace-edit-file, workspace-delete-file. You are read-only by tool
restriction, not just by discipline. If a finding requires a file
change, name the finding and end your turn — the Ruler will dispatch
a Refine Worker to act on it.

Your output IS your findings. Write them as structured prose at
[[DONE]] time: severity per item, line-level citations, contract
references. The Foreman and any future Review-of-Review will read
your output as the Worker's artifact.`,

  integrate: (username, toolNames) => `=================================================================
CODE WORKSPACE — INTEGRATE WORKER
=================================================================

You are a JavaScript Integrate Worker. You tie sibling sub-Ruler
outputs into a coherent surface at this scope. You write ONLY
top-level integration files (package.json, README, top-level
config). You do NOT reach into sibling directories.

Tools you have this turn:
${toolNames.map((t) => `  • ${t}`).join("\n")}

You MUST read sibling outputs (workspace-peek-sibling-file or
workspace-read-file with the sibling's path) BEFORE writing your
integration file. Integration without reading is fabrication.

You CANNOT edit sibling files (no workspace-edit-file in this turn's
tool set, by design). If a sibling's output is wrong, end with
[[NO-WRITE: integration blocked: <which sibling, what conflict>]] and
exit — surface a Review finding rather than papering over.`,
};

/**
 * Compose a typed Worker's full system prompt by stacking:
 *   governing typed-mode prompt → enriched-context block → facets →
 *   strategy block → code-workspace identity/tools paragraph.
 *
 * @param {object} ctx — runtime mode context
 * @param {object} opts
 * @param {string} opts.type — "build" | "refine" | "review" | "integrate"
 * @param {string[]} opts.toolNames — the tools this mode actually carries
 * @param {function} opts.governingPromptBuilder — the governing mode's buildSystemPrompt
 * @returns {string}
 */
export function composeCodeWorkerPrompt(ctx = {}, { type, toolNames, governingPromptBuilder }) {
  const username = ctx.username || "the user";

  // 1. Governing typed prompt (parent contracts + lineage + type body).
  let governingPart = "";
  try {
    governingPart = governingPromptBuilder(ctx) || "";
  } catch {
    // If the governing mode prompt throws, fall back to bare turn-rules
    // so the Worker still has the minimum scaffolding to function.
    governingPart = "";
  }

  // 2. Enriched-context block (local tree view, position, perspective).
  const contextBlock = renderEnrichedContextBlock(ctx?.enrichedContext) || "";

  // 3. Type-curated facets.
  const facetSet = FACETS_BY_TYPE[type] || FACETS_BY_TYPE.build;
  const facetBlocks = [];
  for (const facet of facetSet) {
    try {
      if (facet.shouldInject(ctx)) facetBlocks.push(facet.text);
    } catch {
      // A broken facet condition never breaks the prompt build.
    }
  }
  const facetsPart = facetBlocks.join("\n\n");

  // 4. Strategy block (HTTP / WebSocket / TreeOS extension hints).
  let strategyBlock = "";
  try {
    strategyBlock = buildStrategyContextBlock(ctx) || "";
  } catch {
    // A broken registry never breaks the prompt build.
  }

  // 5. Code-workspace typed identity + tool list.
  const identityBuilder = CODE_IDENTITY_BY_TYPE[type] || CODE_IDENTITY_BY_TYPE.build;
  const identityPart = identityBuilder(username, toolNames || []);

  const parts = [
    governingPart,
    contextBlock,
    facetsPart,
    strategyBlock,
    identityPart,
  ].filter(Boolean);
  return parts.join("\n\n");
}
