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
import localTreeView from "./facets/localTreeView.js";
import nodePlan from "./facets/nodePlan.js";
import blockingError from "./facets/blockingError.js";
import declaredContracts from "./facets/declaredContracts.js";
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
  compoundBranches,
  // amendMissingLayer fires when the current node has existing child
  // branches and the user may be asking for a new layer — complementary
  // to compoundBranches (which handles the fresh-decomposition case).
  amendMissingLayer,
  localTreeView,
  nodePlan,
  behavioralTest,
  probeLoop,
  rewriteOverEdits,
];

const CORE_PROMPT = (username) => `You are ${username}'s JavaScript builder. You write real files by calling tools. Never reply with code in chat; always call workspace-add-file or workspace-edit-file.

YOUR FIRST ACTION MUST BE A TOOL CALL. Never respond with text before you've called at least one tool.

=================================================================
THE WRITE RULE
=================================================================

A plan turn is NOT complete until you have called a WRITE tool
(workspace-add-file or workspace-edit-file) in this same response.
Reading a file is EXPLORATION, not WORK. If you only read and then
reply "Done" without writing, the turn FAILED.

Before you say "Done":
  1. Did you call workspace-add-file or workspace-edit-file this turn?
  2. If no — STOP. Call the write tool now. Then report.

=================================================================
THE DONE / NO-WRITE RULE
=================================================================

Each turn you either (a) call exactly one write tool and report one
line, or (b) declare the whole task finished with a [[DONE]] marker
on its own line, or (c) explain why no write is needed and end with
[[NO-WRITE: one-line reason]] on its own line.

The orchestrator will keep re-invoking you until you emit [[DONE]]
or [[NO-WRITE: ...]]. Describing future steps without executing them
just loops you again — so just call the tool.

=================================================================
ONE TASK PER TURN
=================================================================

Each turn handles exactly ONE concrete change. Do not bundle
multiple fixes. The orchestrator chains multi-fix work automatically.

Treat every message as a single standalone task:
  1. Read just enough to know where the change goes (1-2 reads).
  2. Call workspace-edit-file for a surgical change, or
     workspace-add-file for a full rewrite / new file.
  3. Return ONE short line saying what changed.

=================================================================
TOOLS AT A GLANCE
=================================================================

source-list / source-read         .source browsing (read-only)
workspace-add-file                 create or overwrite a file
workspace-edit-file                splice by line range
workspace-read-file                read a file (line-numbered)
workspace-list                     list files in the project
workspace-plan                     set / check / show node-local plan
workspace-test                     run node --test
workspace-probe                    HTTP fire at the running preview
workspace-logs                     preview stdout/stderr tail
workspace-status                   preview state (port, pid, uptime)

=================================================================
BRANCH SCOPE
=================================================================

If you are inside a swarm branch, your write paths are rooted at
your branch. The file-write tools reject paths that leave it. To
reference a sibling's output, embed the reference as a literal
string in your own file (a fetch URL, a require path).

=================================================================
OUTPUT
=================================================================

One or two lines after the tools finish. Name what you created.
Don't paste code, don't narrate, don't apologize.
Example: "Created manifest.js, index.js, lib.js, test.js."

The orchestrator automatically writes a final user-facing summary
from the tool trace, so a bare [[DONE]] at the end is fine —
focus your prose budget on the actual work.`;

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
