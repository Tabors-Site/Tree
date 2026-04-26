// Unified plan primitive. Plans live in metadata.plan on plan-type
// nodes (type==="plan"). Legacy usage attaches metadata.plan to content
// nodes — still supported, but the authoritative pattern as of Pass 1
// is a dedicated plan-type node living at the scope it coordinates,
// sibling to the work-units it governs. Workers walk up via
// findGoverningPlan(nodeId) to locate their plan.
//
//   metadata.plan = {
//     steps: [
//       {
//         id: "s_<rand>",           // stable id, rotates when plan re-set
//         kind: "write" | "edit" | "branch" | "test" | "probe" | "note" |
//               "chapter" | "scene" | "task" | ...   (open set)
//         stepType: "simple" | "compound" | "passed-down" | "constraining",
//         title: string,            // human readable
//         status: "pending" | "running" | "done" | "failed" | "paused" |
//                 "blocked" | "pending-approval" |
//                 "pending-nested-approval" | "archived",
//         createdAt: ISO,
//         completedAt: ISO | null,
//         blockedReason: string | null,
//         // kind-specific fields:
//         //   branch/chapter:  childNodeId, path, spec, files, slot, mode,
//         //                    branchSignature (stable identity string)
//         //   test:            command, output, passed
//         //   probe:           method, url, expectedStatus, actualStatus
//         //   write/edit:      filePath, bytes
//         //   note:            body
//       }
//     ],
//     rollup: { pending, done, blocked, running, failed, total },
//     version: N,                    // plan revision counter
//     createdAt: ISO,
//     updatedAt: ISO,
//     systemSpec: string | null,     // originating user request (project only)
//     archivedPlans: [               // bounded history of pivoted plans
//       { snapshot, reason, archivedAt, finalStatuses }
//     ],
//     // Pass 1 additions (populated now, consumed by Passes 2-3):
//     contracts: [                   // declared agreements at this scope
//       {
//         id:        string,         // unique slug within plan
//         namespace: string,         // see CONTRACT_NAMESPACES (storage-key,
//                                    //   identifier-set, dom-id, event-name,
//                                    //   message-type, method-signature,
//                                    //   module-export, ...)
//         kind:      string,         // mirrors namespace (Pass 1 invariant)
//         name:      string,         // human label
//         value:     any,            // canonical value (object/string/array)
//         scope:                     // who must comply with this contract:
//           "global"                 //   every branch under this plan
//           | { shared: [string] }   //   specific named branches coordinate
//           | { local:  string }     //   one branch only (declared for visibility)
//         fields:    [string]        // parsed field names from the body;
//                                    //   read by validators (contract
//                                    //   conformance, scout) and by
//                                    //   prompt renderers
//         values:    object          // parsed key→value pairs from the
//                                    //   body; read by domain consumers
//                                    //   (book pronoun scout, code-ws sdk
//                                    //   message-type extraction, etc.)
//         raw:       string          // original architect line; preserved
//                                    //   for debugging and re-rendering
//       }
//     ],
//     ledger: [                      // append-only execution history; Pass 3 reads
//       { at: ISO, event: string, detail: object }
//     ],
//     budget: {                      // resource allocation; Pass 3 weights
//       turnsPerStep, retriesPerBranch, depthAllocation,
//       consumed: { turns, retries, byStepId: {...} }
//     },
//     _userEdit?: true,              // transient flag, consumed by hooks
//     _propagated?: true,            // transient flag, consumed by hooks
//   }
//
// Only THIS extension writes to metadata.plan. Other extensions read it
// via readPlan(nodeId) and mutate it via the exported functions here. The
// api serializes writes per node via mutateMeta so concurrent callers
// cannot clobber each other.
//
// Status vocabulary is the same strings at every kind. Clients (UI,
// facets, rollup) can filter or group by status without caring about
// kind.

import crypto from "crypto";
import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { setExtMeta as kernelSetExtMeta, readNs } from "../../../seed/tree/extensionMetadata.js";

export const NS = "plan";

const ARCHIVED_PLANS_CAP = 10;
const LEDGER_CAP = 500;

const TRANSIENT_FIELDS = new Set(["_userEdit", "_propagated"]);

const STEP_TYPES = new Set(["simple", "compound", "passed-down", "constraining"]);

// Default budget for a plan. Pass 1 ships uniform allocation; Pass 3
// will make these reputation-weighted (per branchSignature). Callers
// may override by passing a budget to initPlan() or mutating directly.
export const DEFAULT_BUDGET = Object.freeze({
  turnsPerStep: 20,
  retriesPerBranch: 1,
  depthAllocation: 1,     // MVP depth cap: one level of sub-plan (Pass 1 decision)
  consumed: { turns: 0, retries: 0, byStepId: {} },
});

/**
 * Normalize a spec string before hashing so signature stability is
 * preserved across runs of the same architect prompt. LLM-generated
 * text drifts by whitespace, punctuation, and case even when the
 * logical content is identical; sha256 over raw text would treat
 * those rephrasings as different specs and produce drifting
 * signatures, breaking Pass 3 reputation aggregation per signature.
 *
 * What this normalizes:
 *   - Lowercases everything.
 *   - Replaces any run of non-alphanumeric characters (punctuation,
 *     whitespace, line breaks) with a single space.
 *   - Trims and collapses repeated spaces.
 *
 * What this does NOT normalize:
 *   - Word order. "build A from B" and "build B from A" still differ.
 *     This is intentional: token order often carries meaning, and
 *     sorting tokens would create false collisions between truly
 *     different specs.
 *   - Synonyms or rephrasings. If the architect emits "implement"
 *     in one run and "build" in the next, the signature still drifts.
 *     That's a deeper problem (semantic stability) deferred to Pass 3
 *     when canonical embedding-keyed signatures may replace this.
 *
 * Net: this kills the noise-floor drift (which is the dominant cause
 * of cross-run signature instability) without false-collapsing
 * meaningful prompt changes.
 */
function normalizeSpecForSignature(spec) {
  if (!spec) return "";
  return String(spec)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Compute a stable identity string for a branch-kind step. The
 * signature is deterministic over (path, title, normalized-spec-hash),
 * so two branches at the same position with the same spec across two
 * runs share a signature. Pass 3 aggregates reputation per signature.
 *
 * Shape: `<path-slug>::<title-slug>::<spec-hash-8>`. Readable in logs
 * and serializes fine through metadata writes.
 *
 * Stability: the spec is run through normalizeSpecForSignature before
 * hashing so that whitespace, punctuation, and case drift across runs
 * of the same architect prompt don't cause signature drift. See that
 * helper's docstring for what is and isn't normalized.
 */
export function computeBranchSignature({ path, title, spec } = {}) {
  const slug = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "anon";
  // Path "." (the conventional root-level / shell branch) would slug
  // to empty → "anon", which collides across runs and namespaces all
  // root-level branches together. Treat "." (or any pure-punctuation
  // path) as the special "root" slug so signatures stay stable and
  // shell branches don't share a signature with arbitrary anon paths.
  const pathSlug = (() => {
    const trimmed = String(path || "").trim();
    if (!trimmed || trimmed === "." || /^[./\\]+$/.test(trimmed)) return "root";
    return slug(trimmed);
  })();
  const specHash = crypto
    .createHash("sha256")
    .update(normalizeSpecForSignature(spec))
    .digest("hex")
    .slice(0, 8);
  return `${pathSlug}::${slug(title)}::${specHash}`;
}

// ─────────────────────────────────────────────────────────────────────
// LOW LEVEL HELPERS (private)
// ─────────────────────────────────────────────────────────────────────

// Thin wrapper over the kernel's readNs so the rest of the file can
// call readMeta(node) without repeating the namespace.
function readMeta(node) {
  return readNs(node, NS);
}

/**
 * Read modify write the plan namespace atomically. All writers go
 * through here so concurrent callers serialize on the Node document.
 * The mutator is called with a mutable draft; return the draft (or a
 * new object). Transient fields (_userEdit, _propagated) are preserved
 * across the call and the caller can set them to signal downstream
 * hooks.
 */
async function mutatePlan(nodeId, mutator, _core) {
  if (!nodeId || typeof mutator !== "function") return null;
  try {
    const node = await Node.findById(nodeId);
    if (!node) return null;
    const current = (node.metadata instanceof Map ? node.metadata.get(NS) : node.metadata?.[NS]) || null;
    const draft = ensureShape(current ? JSON.parse(JSON.stringify(current)) : emptyPlan());
    const out = ensureShape(mutator(draft) || draft);
    out.updatedAt = new Date().toISOString();
    // ALWAYS use the unscoped kernel setExtMeta. The plan extension is
    // the declared owner of metadata.plan, and callers pass their own
    // scoped `core` (from swarm, code-workspace, book-workspace, etc.)
    // which enforces a per-extension namespace whitelist and REJECTS
    // cross-namespace writes. The scope check is the right default for
    // extensions writing into THEIR OWN namespace; here the plan
    // extension is acting on its OWN behalf on behalf of the caller,
    // so we bypass the caller's scope wrapper. Using kernelSetExtMeta
    // directly keeps the atomic $set, the afterMetadataWrite hook fire,
    // and the cache invalidation intact. Caller's core arg is ignored.
    await kernelSetExtMeta(node, NS, out);
    return out;
  } catch (err) {
    log.warn("Plan", `mutatePlan ${nodeId} failed: ${err.message}`);
    return null;
  }
}

function emptyPlan() {
  const nowIso = new Date().toISOString();
  return {
    steps: [],
    rollup: { pending: 0, done: 0, blocked: 0, running: 0, failed: 0, total: 0 },
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    systemSpec: null,
    archivedPlans: [],
    // Pass 1 additions. Populated now, consumed by Passes 2-3.
    contracts: [],
    ledger: [],
    budget: { ...DEFAULT_BUDGET, consumed: { turns: 0, retries: 0, byStepId: {} } },
  };
}

/**
 * Upgrade a draft read from an older plan to the current shape.
 * Existing plans written before Pass 1 fields landed may be missing
 * `contracts` / `ledger` / `budget`; fill them in with defaults so
 * readers don't have to guard. Non-destructive: existing fields win.
 */
function ensureShape(draft) {
  if (!draft || typeof draft !== "object") return draft;
  if (!Array.isArray(draft.contracts)) draft.contracts = [];
  if (!Array.isArray(draft.ledger)) draft.ledger = [];
  if (!draft.budget || typeof draft.budget !== "object") {
    draft.budget = { ...DEFAULT_BUDGET, consumed: { turns: 0, retries: 0, byStepId: {} } };
  } else {
    if (typeof draft.budget.turnsPerStep !== "number") draft.budget.turnsPerStep = DEFAULT_BUDGET.turnsPerStep;
    if (typeof draft.budget.retriesPerBranch !== "number") draft.budget.retriesPerBranch = DEFAULT_BUDGET.retriesPerBranch;
    if (typeof draft.budget.depthAllocation !== "number") draft.budget.depthAllocation = DEFAULT_BUDGET.depthAllocation;
    if (!draft.budget.consumed || typeof draft.budget.consumed !== "object") {
      draft.budget.consumed = { turns: 0, retries: 0, byStepId: {} };
    } else {
      if (typeof draft.budget.consumed.turns !== "number") draft.budget.consumed.turns = 0;
      if (typeof draft.budget.consumed.retries !== "number") draft.budget.consumed.retries = 0;
      if (!draft.budget.consumed.byStepId || typeof draft.budget.consumed.byStepId !== "object") {
        draft.budget.consumed.byStepId = {};
      }
    }
  }
  return draft;
}

function makeStepId() {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  const valid = new Set([
    "pending", "running", "done", "failed", "paused", "blocked",
    "pending-approval", "pending-nested-approval", "archived",
  ]);
  return valid.has(v) ? v : "pending";
}

function cleanStep(raw) {
  if (!raw || typeof raw !== "object") return null;
  const nowIso = new Date().toISOString();
  const kind = String(raw.kind || "task");
  // stepType is orthogonal to kind. Default: "simple". Branch kinds are
  // dispatched-work artifacts, not themselves compound — the compound
  // step lives on the PARENT plan. Callers explicitly set "compound",
  // "passed-down", or "constraining" when they mean it.
  const rawStepType = String(raw.stepType || "simple");
  const stepType = STEP_TYPES.has(rawStepType) ? rawStepType : "simple";
  const step = {
    id: raw.id || makeStepId(),
    kind,
    stepType,
    title: String(raw.title || raw.name || "").trim() || "(untitled step)",
    status: normalizeStatus(raw.status),
    createdAt: raw.createdAt || nowIso,
    completedAt: raw.status === "done" ? (raw.completedAt || nowIso) : null,
    blockedReason: raw.status === "blocked" ? (raw.blockedReason || null) : null,
  };
  // Preserve kind specific fields. We don't enforce a schema; callers
  // add whatever their kind needs (childNodeId, path, spec, files,
  // command, url, etc.).
  const kindKeys = Object.keys(raw).filter((k) =>
    k !== "id" && k !== "kind" && k !== "stepType" && k !== "title" && k !== "name" &&
    k !== "status" && k !== "createdAt" && k !== "completedAt" &&
    k !== "blockedReason" && !TRANSIENT_FIELDS.has(k),
  );
  for (const k of kindKeys) {
    step[k] = raw[k];
  }
  // Auto-compute branchSignature on branch-kind steps when not provided.
  // Signatures are stable across runs (derived from path + title +
  // spec-hash); Pass 3 aggregates reputation per signature.
  if (kind === "branch" && !step.branchSignature) {
    step.branchSignature = computeBranchSignature({
      path: step.path,
      title: step.title,
      spec: step.spec,
    });
  }
  return step;
}

/**
 * Recompute the rollup for a plan from its own steps plus any branch
 * kind step children's rollups. Does NOT walk recursively through
 * children's own plans; that's handled by the afterMetadataWrite hook
 * which propagates up the tree. This function aggregates local steps
 * plus the immediate cached rollups on branch children.
 */
async function computeRollup(plan) {
  const roll = { pending: 0, done: 0, blocked: 0, running: 0, failed: 0, total: 0 };
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  for (const s of steps) {
    const st = s.status || "pending";
    if (roll[st] != null) roll[st] += 1;
    roll.total += 1;
    // Branch steps: add the child's cached rollup (if any) so parents
    // reflect descendant state without walking the full tree.
    if (s.kind === "branch" && s.childNodeId) {
      try {
        const child = await Node.findById(s.childNodeId).select("metadata").lean();
        const childPlan = child ? readMeta(child) : null;
        const childRoll = childPlan?.rollup;
        if (childRoll) {
          roll.pending += childRoll.pending || 0;
          roll.done += childRoll.done || 0;
          roll.blocked += childRoll.blocked || 0;
          roll.running += childRoll.running || 0;
          roll.failed += childRoll.failed || 0;
          roll.total += childRoll.total || 0;
        }
      } catch {}
    }
  }
  return roll;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the plan metadata for a node, delegating to findGoverningPlan
 * as the single plan-discovery primitive. The starting node can be a
 * plan-type node directly, a scope node whose plan is a child, or a
 * descendant deep under a scope. Walk semantics are defined in
 * state/walkUp.js; readPlan is the metadata accessor on top of that.
 *
 * Returns null if no plan is discoverable at or above the node.
 * Snapshot only — do not mutate.
 */
export async function readPlan(nodeId) {
  if (!nodeId) return null;
  try {
    const { findGoverningPlan } = await import("./walkUp.js");
    const planNode = await findGoverningPlan(nodeId);
    return planNode ? readMeta(planNode) : null;
  } catch {
    return null;
  }
}

/**
 * Read the cached rollup. Cheap — no tree walk, reads a precomputed
 * field on the plan. Returns null if no plan.
 */
export async function readRollup(nodeId) {
  const plan = await readPlan(nodeId);
  return plan?.rollup || null;
}

/**
 * Read the archived plans ring. Empty array if none.
 */
export async function readArchivedPlans(nodeId) {
  const plan = await readPlan(nodeId);
  return Array.isArray(plan?.archivedPlans) ? plan.archivedPlans : [];
}

/**
 * Overwrite the entire steps array. Rebuilds step ids if missing and
 * normalizes statuses. Bumps version only if the caller passes
 * bumpVersion: true. Rollup is recomputed.
 */
export async function setSteps(nodeId, steps, core, { bumpVersion = false, systemSpec = null } = {}) {
  if (!nodeId) return null;
  const normalized = (Array.isArray(steps) ? steps : []).map(cleanStep).filter(Boolean);
  const out = await mutatePlan(nodeId, (draft) => {
    draft.steps = normalized;
    if (bumpVersion) draft.version = (draft.version || 0) + 1;
    if (systemSpec !== null && systemSpec !== undefined) {
      draft.systemSpec = systemSpec;
    }
    return draft;
  }, core);
  await recomputeRollup(nodeId, core);
  return out;
}

/**
 * Append one step. Returns the created step (with its generated id if
 * none was provided). Rollup is recomputed.
 */
export async function addStep(nodeId, step, core) {
  if (!nodeId) return null;
  const cleaned = cleanStep(step);
  if (!cleaned) return null;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) draft.steps = [];
    draft.steps.push(cleaned);
    return draft;
  }, core);
  await recomputeRollup(nodeId, core);
  return cleaned;
}

/**
 * Update a single step by id with a partial patch. Idempotent: if the
 * patch matches the existing step byte for byte, returns { changed:
 * false } and skips the write. Otherwise merges the patch in, updates
 * completedAt / blockedReason based on status transitions, recomputes
 * rollup.
 *
 * Callers can stamp _userEdit on the draft (via a second update) to
 * signal the propagation hook that a human edit happened. This is used
 * by the swarm plan panel's inline edit flow to fire sibling signals.
 */
export async function updateStep(nodeId, stepId, patch, core, flags = {}) {
  if (!nodeId || !stepId || !patch) return { changed: false };
  const nowIso = new Date().toISOString();
  let changed = false;
  let updatedStep = null;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) return draft;
    const idx = draft.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return draft;
    const before = draft.steps[idx];
    const next = { ...before };
    for (const [k, v] of Object.entries(patch)) {
      if (TRANSIENT_FIELDS.has(k)) continue;
      if (k === "status") {
        const norm = normalizeStatus(v);
        if (norm !== before.status) {
          next.status = norm;
          if (norm === "done" && before.status !== "done") {
            next.completedAt = nowIso;
          } else if (norm !== "done") {
            next.completedAt = null;
          }
          if (norm === "blocked") {
            next.blockedReason = patch.blockedReason || before.blockedReason || null;
          } else if (k === "status") {
            next.blockedReason = null;
          }
          changed = true;
        }
      } else if (k !== "blockedReason") {
        const prev = before[k];
        const same = Array.isArray(v) && Array.isArray(prev)
          ? v.length === prev.length && v.every((x, i) => x === prev[i])
          : prev === v;
        if (!same) {
          next[k] = v;
          changed = true;
        }
      }
    }
    if (changed) {
      draft.steps[idx] = next;
      updatedStep = next;
      if (flags?.userEdit) draft._userEdit = true;
    }
    return draft;
  }, core);
  if (changed) await recomputeRollup(nodeId, core);
  return { changed, step: updatedStep };
}

/**
 * Delete a step by id. Returns { removed: true } if it existed.
 */
export async function deleteStep(nodeId, stepId, core) {
  if (!nodeId || !stepId) return { removed: false };
  let removed = false;
  await mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.steps)) return draft;
    const before = draft.steps.length;
    draft.steps = draft.steps.filter((s) => s.id !== stepId);
    if (draft.steps.length < before) removed = true;
    return draft;
  }, core);
  if (removed) await recomputeRollup(nodeId, core);
  return { removed };
}

/**
 * Find-or-create a branch kind step on a parent's plan, matching by
 * branch name (step.title). Merges a patch into the matching step or
 * creates a new one.
 *
 * The "upsert by title" predicate is useful because swarm (and any
 * other branch-style dispatcher) tracks branches by human-readable
 * name rather than by the step's internal id. Used to live as a
 * convenience in swarm/state/planAccess.js; promoted here so that
 * any extension dispatching branch-like work shares one authoritative
 * upsert path.
 *
 *   upsertBranchStep(parentNodeId, {
 *     name: "backend", spec: "...", path: "backend",
 *     files: ["server.js"], status: "pending",
 *     nodeId: childNodeId,      // or pass as childNodeId
 *   }, core);
 *
 * Undefined fields are stripped before merge so a partial patch does
 * not clobber existing values with `undefined`.
 */
export async function upsertBranchStep(parentNodeId, branch, core) {
  if (!parentNodeId || !branch?.name) return null;
  const existing = await readPlan(parentNodeId);
  const match = existing?.steps?.find(
    (s) => s.kind === "branch" && s.title === branch.name,
  );
  const stepData = {
    kind: "branch",
    title: branch.name,
    status: branch.status || "pending",
    spec: branch.spec,
    path: branch.path,
    files: branch.files,
    slot: branch.slot,
    mode: branch.mode,
    childNodeId: branch.nodeId || branch.childNodeId || null,
    parentBranch: branch.parentBranch,
    summary: branch.summary,
    error: branch.error,
    finishedAt: branch.finishedAt,
    startedAt: branch.startedAt,
    pausedAt: branch.pausedAt,
    abortReason: branch.abortReason,
    retries: branch.retries,
  };
  // Strip undefined so we don't overwrite existing fields with nothing.
  for (const k of Object.keys(stepData)) {
    if (stepData[k] === undefined) delete stepData[k];
  }
  if (match) {
    const result = await updateStep(parentNodeId, match.id, stepData, core);
    return result?.step || match;
  }
  return addStep(parentNodeId, stepData, core);
}

/**
 * Create a plan-type node at the given parent scope and initialize
 * its plan metadata. This is the canonical constructor for the
 * "plan as a first-class node" pattern — a dedicated plan-type
 * node lives at the scope it coordinates, as a sibling of the
 * work-units it governs. Workers walk up via findGoverningPlan(nodeId)
 * to locate it.
 *
 *   createPlanNode({
 *     parentNodeId,           // where the plan-type node lives
 *     userId,                 // required for contribution logging
 *     name,                   // human-readable, e.g. "game-plan"
 *     systemSpec,             // originating user request, if this is a
 *                             //   project-level plan
 *     steps,                  // optional initial steps array
 *     budget,                 // optional override of DEFAULT_BUDGET
 *     stepType,               // default for step cleaning if step omits it
 *     wasAi,                  // contribution log flag
 *     chatId, sessionId,      // contribution log context
 *     core,                   // passed through for mutatePlan
 *   })
 *
 * Returns the new plan Node (Mongoose doc). Throws on creation failure.
 */
export async function createPlanNode({
  parentNodeId,
  userId,
  name,
  systemSpec = null,
  steps = null,
  budget = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
  core = null,
} = {}) {
  if (!parentNodeId) throw new Error("createPlanNode requires parentNodeId");
  if (!userId) throw new Error("createPlanNode requires userId");
  if (!name || !String(name).trim()) throw new Error("createPlanNode requires name");

  // Structural invariant: a plan-type node cannot be a direct child of
  // another plan-type node. Between two plans there must be a scope
  // node (a content node or a branch node) that the inner plan
  // coordinates. Violating this means the tree no longer expresses
  // "plan describes work at a scope, work lives alongside the plan"
  // and every walk-up primitive starts producing wrong answers.
  const parentDoc = await Node.findById(parentNodeId).select("_id type").lean();
  if (!parentDoc) throw new Error(`createPlanNode: parent ${parentNodeId} not found`);
  if (parentDoc.type === "plan") {
    throw new Error(
      `createPlanNode: cannot create a plan-type node as a direct child of another plan-type node (${parentNodeId}). ` +
      `Plans coordinate work at a scope; a scope node (content or branch) must sit between two plans.`,
    );
  }

  // Dynamic import to avoid a seed→extension cycle: this file is inside
  // an extension, and createNode lives in seed. Importing it at module
  // top level is fine (seed has no back-references) but we do it lazily
  // to keep plan.js's import list readable.
  const { createNode } = await import("../../../seed/tree/treeManagement.js");
  const planNode = await createNode({
    name: String(name).trim(),
    parentId: String(parentNodeId),
    type: "plan",
    userId,
    wasAi,
    chatId,
    sessionId,
  });
  await initPlan(planNode._id, { systemSpec, budget }, core);
  if (Array.isArray(steps) && steps.length > 0) {
    await setSteps(planNode._id, steps, core, { bumpVersion: true });
  }
  await appendLedger(planNode._id, {
    event: "plan-created",
    detail: {
      parentNodeId: String(parentNodeId),
      initialStepCount: Array.isArray(steps) ? steps.length : 0,
      systemSpec: systemSpec ? String(systemSpec).slice(0, 200) : null,
    },
  }, core);

  // Orphan plan diagnostic. If a sibling plan-type node already
  // exists under the same parent, that's a sign of orphaned state
  // from a prior run that never got cleaned up. Log it explicitly
  // — Pass 1's data audit needs to know about siblings so the
  // operator can decide to archive or merge them.
  try {
    const siblingPlans = await Node.find({
      parent: parentNodeId,
      type: "plan",
      _id: { $ne: planNode._id },
    }).select("_id name").lean();
    if (siblingPlans.length > 0) {
      log.warn(
        "Plan",
        `🪦 Orphan plan(s) detected: ${siblingPlans.length} prior plan-type sibling(s) under parent ${String(parentNodeId).slice(0, 8)}: ` +
        siblingPlans.map((p) => `"${p.name}" (${String(p._id).slice(0, 8)})`).join(", ") +
        `. New plan: "${planNode.name}" (${String(planNode._id).slice(0, 8)}). ` +
        `Operator should archive or merge orphans.`,
      );
    }
  } catch {}

  return planNode;
}

/**
 * Find-or-create the plan-type child at a scope. This is the primary
 * entrypoint for dispatch: callers pass a scope node id and get the
 * plan node to write steps to.
 *
 *   - scopeNodeId IS a plan-type node → return it (idempotent).
 *   - scopeNodeId has a plan-type child → return that child.
 *   - Neither → create a new plan-type child via createPlanNode.
 *
 * Required: `userId` when creating. Optional: `name` (defaults to
 * `${scopeName}-plan`), `systemSpec`, `budget`.
 */
export async function ensurePlanAtScope(scopeNodeId, {
  userId,
  name = null,
  systemSpec = null,
  budget = null,
  wasAi = false,
  chatId = null,
  sessionId = null,
} = {}, core = null) {
  if (!scopeNodeId) return null;
  const scopeNode = await Node.findById(scopeNodeId).select("_id name type").lean();
  if (!scopeNode) return null;
  if (scopeNode.type === "plan") return scopeNode;

  const existing = await Node.findOne({
    parent: scopeNodeId,
    type: "plan",
  }).select("_id name parent type metadata").lean();
  if (existing) return existing;

  if (!userId) {
    throw new Error(
      "ensurePlanAtScope requires userId to create a plan-type child at a scope that has no existing plan",
    );
  }
  return createPlanNode({
    parentNodeId: String(scopeNodeId),
    userId,
    // Plain "plan" — no coupling to the scope's name. The parent
    // pointer + type="plan" encode the hierarchy; duplicating the
    // scope name in the plan's name would go stale the moment the
    // scope is renamed, and the type field already makes the node
    // queryable without relying on naming convention.
    name: name || "plan",
    systemSpec,
    budget,
    wasAi, chatId, sessionId,
    core,
  });
}

/**
 * Initialize (or reinitialize) a plan at the given node. Does NOT
 * clobber existing steps. Stamps systemSpec and createdAt if missing.
 * Called by swarm when a project root first gets decomposed and by
 * extensions setting up a new planning target.
 *
 * `budget` may be passed to override the default allocation for this
 * plan. Pass 3 will compute budgets from signature reputation; Pass 1
 * callers generally rely on DEFAULT_BUDGET.
 */
export async function initPlan(nodeId, { systemSpec = null, budget = null } = {}, core) {
  if (!nodeId) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!draft.createdAt) draft.createdAt = new Date().toISOString();
    if (systemSpec) draft.systemSpec = systemSpec;
    if (!Array.isArray(draft.steps)) draft.steps = [];
    if (!Array.isArray(draft.archivedPlans)) draft.archivedPlans = [];
    if (budget && typeof budget === "object") {
      draft.budget = {
        ...DEFAULT_BUDGET,
        ...budget,
        consumed: { turns: 0, retries: 0, byStepId: {}, ...(budget.consumed || {}) },
      };
    }
    return draft;
  }, core);
}

/**
 * Append an entry to the plan's ledger. Ledger is the append-only
 * execution history for this plan — every dispatch, branch completion,
 * retry, failure, archive, pivot. Pass 3 aggregates ledger entries
 * into reputation signals. Capped at LEDGER_CAP; oldest entries drop.
 *
 * Entry shape: { event: string, detail?: object }. `at` is stamped
 * automatically. Callers should pick stable event names so Pass 3's
 * aggregation works consistently: "plan-created", "plan-dispatched",
 * "branch-completed", "branch-failed", "plan-archived", etc.
 */
export async function appendLedger(nodeId, entry, core) {
  if (!nodeId || !entry?.event) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!Array.isArray(draft.ledger)) draft.ledger = [];
    draft.ledger.push({
      at: new Date().toISOString(),
      event: String(entry.event),
      detail: entry.detail || null,
    });
    if (draft.ledger.length > LEDGER_CAP) {
      draft.ledger.splice(0, draft.ledger.length - LEDGER_CAP);
    }
    return draft;
  }, core);
}

/**
 * Record budget consumption for a specific step. Pass 3 reads the
 * consumed map to attribute actual work to signatures. No enforcement
 * in Pass 1 — the budget is advisory. Callers pass { turns, retries }
 * deltas; both default to 0.
 */
export async function recordBudgetConsumption(nodeId, stepId, { turns = 0, retries = 0 } = {}, core) {
  if (!nodeId || !stepId) return null;
  if (turns === 0 && retries === 0) return null;
  return mutatePlan(nodeId, (draft) => {
    if (!draft.budget) draft.budget = { ...DEFAULT_BUDGET, consumed: { turns: 0, retries: 0, byStepId: {} } };
    if (!draft.budget.consumed) draft.budget.consumed = { turns: 0, retries: 0, byStepId: {} };
    draft.budget.consumed.turns = (draft.budget.consumed.turns || 0) + turns;
    draft.budget.consumed.retries = (draft.budget.consumed.retries || 0) + retries;
    const existing = draft.budget.consumed.byStepId[stepId] || { turns: 0, retries: 0 };
    draft.budget.consumed.byStepId[stepId] = {
      turns: existing.turns + turns,
      retries: existing.retries + retries,
    };
    return draft;
  }, core);
}

/**
 * Find a branch kind step that points at `childNodeId` and update its
 * status / summary / error / finishedAt. Convenience wrapper that
 * replaces the old setBranchStatus flow: when a branch execution
 * finishes, this updates the parent's view of that branch without
 * callers needing to know the parent nodeId or step id.
 *
 * parentNodeId must be provided (from the branch's swarm bookkeeping
 * metadata, parentProjectId). Falls silently if no match is found.
 */
export async function setBranchStepStatus({ parentNodeId, childNodeId, status, summary, error, core }) {
  if (!parentNodeId || !childNodeId) return { changed: false };
  const parent = await readPlan(parentNodeId);
  if (!parent) return { changed: false };
  const step = parent.steps?.find((s) => s.kind === "branch" && String(s.childNodeId) === String(childNodeId));
  if (!step) return { changed: false };
  const patch = {};
  if (status != null) patch.status = status;
  if (summary !== undefined) patch.summary = summary;
  if (error !== undefined) patch.error = error;
  patch.finishedAt = new Date().toISOString();
  return updateStep(parentNodeId, step.id, patch, core);
}

/**
 * Archive the current plan into archivedPlans[] (ring capped) and
 * reset steps. Used on user pivot, user cancel, session reset while a
 * plan is in flight.
 */
export async function archivePlan({ nodeId, reason, core }) {
  if (!nodeId) return null;
  const nowIso = new Date().toISOString();
  return mutatePlan(nodeId, (draft) => {
    const steps = Array.isArray(draft.steps) ? draft.steps : [];
    if (!Array.isArray(draft.archivedPlans)) draft.archivedPlans = [];
    if (steps.length === 0) {
      // Nothing meaningful to archive. Still ensure the reset shape.
      draft.steps = [];
      draft.version = draft.version || 0;
      return draft;
    }
    const statusCounts = steps.reduce((acc, s) => {
      const k = s.status || "unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    draft.archivedPlans.push({
      snapshot: {
        steps: JSON.parse(JSON.stringify(steps)),
        version: draft.version || 0,
      },
      reason: reason || "unspecified",
      archivedAt: nowIso,
      finalStatuses: statusCounts,
    });
    while (draft.archivedPlans.length > ARCHIVED_PLANS_CAP) {
      draft.archivedPlans.shift();
    }
    draft.steps = [];
    draft.version = 0;
    return draft;
  }, core);
}

/**
 * Recompute the cached rollup and write it back. Called automatically
 * after every step mutation. Callers can invoke directly if they wrote
 * to a child's plan and want the parent's rollup to pick up the change
 * immediately (otherwise the afterMetadataWrite hook propagates within
 * the next tick).
 */
export async function recomputeRollup(nodeId, core) {
  if (!nodeId) return null;
  const plan = await readPlan(nodeId);
  if (!plan) return null;
  const roll = await computeRollup(plan);
  return mutatePlan(nodeId, (draft) => {
    draft.rollup = roll;
    draft._propagated = true; // tells the hook this write is internal
    return draft;
  }, core);
}

/**
 * Walk from nodeId upward, recomputing rollups at every ancestor. Used
 * when a deep descendant's plan changes and we want the rollup to
 * propagate immediately rather than waiting for hooks.
 */
export async function rollupUpward(nodeId, core) {
  if (!nodeId) return;
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const hasPlan = !!readMeta(n);
    if (hasPlan) {
      await recomputeRollup(cursor, core);
    }
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Find the branch kind step on a parent that points at childNodeId.
 * Returns the step or null. Used by consumers that need to look up
 * step metadata (summary, status) from the child's perspective.
 */
export async function findBranchStep(parentNodeId, childNodeId) {
  const plan = await readPlan(parentNodeId);
  if (!plan) return null;
  return plan.steps?.find(
    (s) => s.kind === "branch" && String(s.childNodeId) === String(childNodeId),
  ) || null;
}

/**
 * Filter helpers that are common enough to centralize.
 */
export function branchSteps(plan) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.kind === "branch");
}

export function stepsByKind(plan, kind) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.kind === kind);
}

export function pendingSteps(plan) {
  if (!plan?.steps) return [];
  return plan.steps.filter((s) => s.status === "pending");
}
