/**
 * tree:code-plan — imperative building mode.
 *
 * Shrunk from a 400-line rulebook to a ~1.5KB core + conditional
 * facets. The core is everything that applies on every turn: role,
 * first-action rule, write rule, done/no-write rule, one-task-per-
 * turn, tool reference, output style. Facets in ./facets/ are
 * conditionally inlined by `buildSystemPrompt(ctx)` based on
 * context state:
 *
 *   compoundBranches  — turn 1 at an empty project root
 *   behavioralTest    — project has contracts or tests/ dir
 *   probeLoop         — project has a live HTTP surface
 *   rewriteOverEdits  — AI has edited any file 2+ times this session
 *   localTreeView     — always, when localView is populated
 *
 * Result: average turn gets a ~2-4KB system prompt instead of ~18KB.
 * The AI's attention budget isn't spent on rules that don't apply.
 *
 * If a facet's `shouldInject(ctx)` can't read the state it needs
 * (e.g. non-enrichContext callers), the facet is silently skipped
 * and the core alone carries the turn.
 */

import compoundBranches from "./facets/compoundBranches.js";
import amendMissingLayer from "./facets/amendMissingLayer.js";
import behavioralTest from "./facets/behavioralTest.js";
import probeLoop from "./facets/probeLoop.js";
import rewriteOverEdits from "./facets/rewriteOverEdits.js";
import nodePlan from "./facets/nodePlan.js";
import blockingError from "./facets/blockingError.js";
import declaredContracts from "./facets/declaredContracts.js";
import branchWorker from "./facets/branchWorker.js";
import siblings from "./facets/siblings.js";
import renderEnrichedContextBlock from "./renderContext.js";
import { buildStrategyContextBlock } from "../strategyRegistry.js";

const FACETS = [
  // blockingError goes FIRST so a red banner is the first thing the
  // AI reads when a file is unparseable. Every other instruction is
  // irrelevant until the blocker clears.
  blockingError,
  // declaredContracts goes next — every branch session must see the
  // architect's wire protocol at the top of its prompt, not buried
  // under local planning guidance.
  declaredContracts,
  // siblings immediately after — with sibling visibility + contracts
  // together, the branch has both the declared protocol and the actual
  // code siblings wrote. Invented interfaces become impossible.
  siblings,
  // compoundBranches is for architect-at-empty-root only (skips when
  // swarmRole === "branch"). branchWorker is the mutually exclusive
  // counterpart, framing parent-plan lifecycle + sub-plan capability
  // for workers inside dispatched branches.
  compoundBranches,
  branchWorker,
  // amendMissingLayer fires when the current node has existing child
  // branches and the user may be asking for a new layer — complementary
  // to compoundBranches (which handles the fresh-decomposition case).
  amendMissingLayer,
  nodePlan,
  behavioralTest,
  probeLoop,
  rewriteOverEdits,
];

const CORE_PROMPT = (username) => `You are ${username}'s JavaScript builder. Write real files via tools (workspace-add-file / workspace-edit-file). Never reply with code in chat.

=================================================================
TURN RULES
=================================================================

Each turn does ONE concrete thing. Either:
  (a) call exactly one write tool, then one line of output, OR
  (b) end with [[DONE]] on its own line — task complete, OR
  (c) end with [[NO-WRITE: short reason]] — this turn legitimately
      needs no write.

Reading without writing is a failed turn. The orchestrator re-invokes
you until you emit [[DONE]] or [[NO-WRITE]]. Describing future work
without doing it just loops you. Just call the tool.

The orchestrator writes the user-facing summary from your tool trace,
so a bare [[DONE]] is fine. Focus your prose budget on the work.

=================================================================
BRANCH SCOPE (when inside a swarm branch)
=================================================================

Your write paths are rooted at your branch — paths that leave it
are rejected. Cross-branch READS are allowed: workspace-read-file
with filePath="game/game.js" or "../game/game.js". You can NEVER
write into a sibling. To use a sibling at runtime, embed the
reference (script tag, fetch URL, require path) as a literal string.

Read sparingly. Each read stays in context for the rest of the turn.
The "Sibling Branches" block already shows each sibling's exports
and surface line — use those first. Only read a full sibling file
when the summary is genuinely insufficient.`;

export default {
  name: "tree:code-plan",
  emoji: "🗺️",
  label: "Code Plan",
  bigMode: "tree",

  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  // One tool call per LLM generation keeps each call short (30-90s on a
  // 27B local model) so individual generations never come close to the
  // 5-minute request timeout that kills slow responses. The continuation
  // loop in runSteppedMode handles the chaining — many cheap calls beat
  // one expensive call.
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 20,

  toolNames: [
    "workspace-add-file",
    "workspace-edit-file",
    "workspace-read-file",
    "workspace-list",
    "workspace-delete-file",
    "workspace-test",
    "workspace-probe",
    "workspace-logs",
    "workspace-status",
    "workspace-plan",
    "source-read",
    "source-list",
    "get-tree-context",
    "navigate-tree",
  ],

  buildSystemPrompt(ctx = {}) {
    const core = CORE_PROMPT(ctx.username || "the user");
    const facetBlocks = [];
    for (const facet of FACETS) {
      try {
        if (facet.shouldInject(ctx)) facetBlocks.push(facet.text);
      } catch {
        // A broken facet condition never breaks the prompt build.
      }
    }
    const contextBlock = renderEnrichedContextBlock(ctx?.enrichedContext);
    // Strategy packages (code-strategy-http, code-strategy-websocket,
    // code-strategy-treeos-extension, ...) each contribute a short
    // explanatory block. Only blocks whose predicate matches this ctx
    // are inlined — an HTTP-only project never sees the websocket block.
    let strategyBlock = "";
    try {
      strategyBlock = buildStrategyContextBlock(ctx) || "";
    } catch {
      // A broken registry never breaks the prompt build.
    }
    const parts = [core];
    if (contextBlock) parts.push(contextBlock);
    if (facetBlocks.length > 0) parts.push(facetBlocks.join("\n\n"));
    if (strategyBlock) parts.push(strategyBlock);
    return parts.join("\n\n");
  },
};
