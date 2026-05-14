// Shared prompt scaffold for typed Workers.
//
// Workers come in four base types — Build, Refine, Review, Integrate.
// Each type is a distinct cognitive shape the Planner picks per leaf
// step. The Foreman sees the type per frame. Reputation reads which
// types this scope has handled across its life. The type is the unit
// of judgment, not the workspace.
//
// All four typed modes share the same prelude (parent contracts +
// lineage + plan), the same scope-undershoot self-promotion path,
// the same turn rules. Only the BODY block differs — the cognitive
// shape of the work. This file owns the shared shape; the four mode
// files own their body.

const COMMON_TURN_RULES = `TURN RULES

Each turn does ONE concrete thing. Either:
  (a) call exactly one write tool, then one line of output, OR
  (b) end with [[DONE]] on its own line — task complete, OR
  (c) end with [[NO-WRITE: short reason]] — this turn legitimately
      needs no write.

Reading without writing is a failed turn. The orchestrator re-invokes
you until you emit [[DONE]] or [[NO-WRITE]]. Describing future work
without doing it just loops you. Just call the tool.

EVERY WORKER TURN MUST END WITH ONE OF THESE FOUR SHAPES

The dispatcher classifies your turn against these four; anything
else lands you in "failed" with no leaf realized:

  1. A write tool call that produces the promised artifact
     (create-node-note, edit-node-note, create-new-node-branch,
     workspace-add-file, workspace-edit-file, etc.). Workspace
     write tools count; governance/flag/foreman tools do NOT — the
     dispatcher excludes coordination tools from the "artifact
     produced" check. Status: done.

  2. governing-flag-issue with severity="blocking" when you can
     identify the structural reason this leaf cannot be done as
     specified (the contract is wrong, your tool set can't produce
     what's asked, two contracts collide). Status: blocked. The
     Ruler reads the flag and decides whether to replan or
     escalate. Do NOT also emit [[DONE]] in the same turn — the
     blocking flag IS your exit.

  3. [[NO-WRITE: <one-line reason>]] when the leaf is satisfied
     without a write (the artifact already exists exactly as
     specified, or the spec was for an inspection-only step).
     Status: blocked-with-reason. Cheap exit when the work is
     genuinely a no-op.

  4. [[BRANCHES]] block when the leaf is compound and should be a
     scope (see SCOPE UNDERSHOOT below). Status: advanced. The
     dispatcher promotes this node to Ruler and recurses; your
     turn ended with the work moved, not finished here.

A turn with only reads and no write/flag/marker is a SUBSTRATE
VIOLATION — the dispatcher classifies it as "failed" and the leaf
status reflects that. Do not end on reads.`;

const COMMON_CONTRACTS_BLOCK = `CONTRACTS IN FORCE

The contracts your Ruler ratified are visible in your context. Every
shared identifier, event name, storage key, dom id, or function
signature you reference must match the contract verbatim. If you
need a name the contracts do not declare, you are either inventing
shared vocabulary (forbidden — surface a missing contract instead of
inventing one) or working with a local detail (write it freely).`;

const COMMON_UNDERSHOOT_BLOCK = `SCOPE UNDERSHOOT — SELF-PROMOTE TO RULER

If the work at this scope is compound (two or more independent
sub-domains, each substantial enough to need its own plan), do NOT
try to do it all yourself. Emit a [[BRANCHES]] block instead. The
dispatcher promotes this node to Ruler and runs a Planner/Contractor
cycle for each named branch.

[[BRANCHES]] format. ALL branches in ONE block. Open once, close
once. One branch per entry, fields name + spec + files:

    [[BRANCHES]]
    branch: <name>
      spec: <one paragraph — what this sub-domain owns end to end>
      files: <concrete files this sub-domain will write>

    branch: <other-name>
      spec: ...
      files: ...
    [[/BRANCHES]]

The branch name IS the directory name and the scope name. The branch
writes its files at its own position in the tree, in a subdirectory
named for the branch. Integration files at THIS scope are not a
branch; they are this Ruler's own files, written through Worker
calls before or after sub-branches dispatch.

Single-task work ("write a vowel counter", "fix this off-by-one")
does NOT branch. Just write the file or the note.

Close [[BRANCHES]] with [[DONE]] on its own line.`;

/**
 * Compose the system prompt for a typed worker. The body argument is
 * the type-specific paragraph block that distinguishes Build from
 * Refine from Review from Integrate.
 *
 * @param {object} ctx — runtime mode context (carries username + enrichedContext)
 * @param {object} opts
 * @param {string} opts.typeLabel — display label (e.g. "Build Worker")
 * @param {string} opts.body — type-specific judgment block
 * @returns {string} the assembled system prompt
 */
export function buildWorkerPrompt(ctx, { typeLabel, body }) {
  const { username } = ctx;
  const e = ctx.enrichedContext || {};
  const parentBlocks = [
    e.governingLineage,
    e.governingParentPlan,
    e.governingContracts,
  ].filter(Boolean).join("\n\n");
  const prelude = parentBlocks ? `${parentBlocks}\n\n` : "";

  return prelude + `You are a ${typeLabel}. ${username}'s Ruler at this scope has
hired you to execute the work the Ruler is responsible for.

${COMMON_TURN_RULES}

${body}

${COMMON_CONTRACTS_BLOCK}

${COMMON_UNDERSHOOT_BLOCK}`.trim();
}

// Tools every typed Worker carries regardless of workspace
// specialization. ONLY governing-flag-issue — Workers surface
// contract issues during their work and the flag accumulates on the
// Ruler's queue for Pass 2 court adjudication.
//
// Deliberately NOT in the base set:
//   • get-tree-context — kernel tool that reads the whole tree;
//     Workers must not see outside their scope. Cross-scope visibility
//     is the Ruler's concern, not the Worker's.
//   • navigate-tree — same reason; lets Workers move position
//     anywhere in the tree, breaking scope discipline.
//
// Workspace typed Workers extend this list with their workspace tools
// (workspace-add-file, workspace-read-file, etc.). Those tools are
// scope-aware — workspace-read-file knows about the worker's scope
// and rejects paths outside it. The kernel's tree tools are NOT
// scope-aware; including them would let Workers reach across.
export const WORKER_BASE_TOOLS = [
  "governing-flag-issue",
];

// The shared base config every typed worker mode reuses. Per-type
// modes override `name`, `emoji`, `label`, and `buildSystemPrompt`.
// `toolNames` is just the flag tool; workspace extensions extend
// with scope-aware domain tools by spreading WORKER_BASE_TOOLS into
// their own toolNames declarations.
//
// A governing base typed Worker without a workspace specialization
// carries ONLY the flag tool — meaning it can flag-and-exit but not
// modify the tree. That's intentional: governance doesn't author
// artifacts; workspaces do. A bare governing Worker on a land
// without an active workspace either flags-and-exits or runs
// vacuously.
export const WORKER_BASE_CONFIG = {
  bigMode: "tree",
  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 1,
  maxSteppedRuns: 20,
  toolNames: [...WORKER_BASE_TOOLS],
};

// Canonical type list. Single source of truth — dispatch, planner
// schema, executionStack snapshot, and the Foreman wakeup payload
// all read this list. Adding a fifth type means adding it here, a
// matching mode file, and an entry in the Planner's selection
// guidance.
export const WORKER_TYPES = ["build", "refine", "review", "integrate"];

export const DEFAULT_WORKER_TYPE = "build";

// Map worker type → governing mode key. Workspaces can override per
// type via their manifest's provides.workerTypes; the dispatcher
// consults the workspace registration first, then falls back to
// these governing base modes.
export const WORKER_TYPE_MODE_KEYS = {
  build: "tree:governing-worker-build",
  refine: "tree:governing-worker-refine",
  review: "tree:governing-worker-review",
  integrate: "tree:governing-worker-integrate",
};

export function isValidWorkerType(t) {
  return typeof t === "string" && WORKER_TYPES.includes(t);
}

export function coerceWorkerType(t) {
  return isValidWorkerType(t) ? t : DEFAULT_WORKER_TYPE;
}
