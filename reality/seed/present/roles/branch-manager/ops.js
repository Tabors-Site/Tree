// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// branch-manager ops. The DO operations the @branch-manager delegate
// exposes for branch lifecycle.
//
// One op for Pass 3: `create-branch`. Forks a new world from a past
// point of an existing branch. The substrate's createBranch helper
// does the heavy lifting (path arithmetic, branchPoint snapshot,
// Branch row, child space).
//
// Auth: any heaven authority (hasAccess on heaven) can mint a branch off any branch they can
// SEE. Promotion to live / pause / delete (Pass 6.5 + 10) require
// tighter permissions; for branch creation, the principle is "anyone
// who can read can fork" — branches are isolated worlds, the parent
// is unaffected.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { createBranch } from "../../../materials/branch/branchCreation.js";
import {
  MAIN,
  invalidateBranchCache,
  commonAncestor,
} from "../../../materials/branch/branches.js";
import Branch from "../../../materials/branch/branch.js";
import { computeMergeResetFacts } from "../../../materials/branch/resetReels.js";
import { emitFact } from "../../../past/fact/facts.js";
import {
  readPointers,
  POINTER_NAME_RE,
  POINTER_NAME_MAX_LENGTH,
  RESERVED_POINTERS,
  findPointersSpaceId,
  pointersFor,
  isPointerName,
} from "../../../materials/branch/branchRegistry.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { registerRoleWord } from "../../word/roleWordRegistry.js";
import log from "../../../seedReality/log.js";

// Self-register this module's co-located `.word` slice (CONVERTING.md): importing
// ops.js (at seed boot, or in a DRY harness) registers it so resolveRoleWord(
// "branch-manager", "set-pointer") finds it. The cut wires the bridge into the
// set-pointer handler (run the .word's CONTROL strand through runRoleWord with
// branchManagerHostEnv; JS handler stays as the clean-miss fallback).
registerRoleWord("branch-manager", "set-pointer", new URL("./branch-manager.word", import.meta.url));
registerRoleWord("branch-manager", "delete-pointer", new URL("./delete-pointer.word", import.meta.url));

// Canonical-path grammar (mirrors BRANCH_RE in address.js). Used by
// set-pointer to reject structurally-invalid `canonical` arguments.
const CANONICAL_PATH_RE = /^(?:0|\d+(?:[a-z]+\d+)*(?:[a-z]+)?)$/;

export function registerBranchManagerOps() {
  // The actual registerOperation call lives at module load (side
  // effect); this empty function is the explicit entry point so
  // genesis.js can import + call it the same way it does for
  // role-manager / llm-assigner.
}

registerOperation("create-branch", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    parent: {
      type:        "text",
      label:       "Parent branch path (e.g. \"0\" for main, \"1a\" for a nested branch)",
      required:    false,
      default:     MAIN,
    },
    atSeq: {
      type:     "number",
      label:    "Branch from this seq on the parent's reel (substrate-native; preferred when known)",
      required: false,
    },
    atTimestamp: {
      type:     "text",
      label:    "Branch from this ISO timestamp (human helper; resolved per-reel)",
      required: false,
    },
    label: {
      type:     "text",
      label:    "Label (optional human-readable name)",
      required: false,
    },
    pointer: {
      type:     "text",
      label:    "Optional named pointer to attach to the new branch in the same call (e.g. \"feature-x\"). Equivalent to following create-branch with set-pointer.",
      required: false,
    },
    reassignPointer: {
      type:     "bool",
      label:    "If the pointer is already taken, move it to the new branch (the old branch keeps its canonical path but loses the pointer). Without this, a taken pointer is refused.",
      required: false,
      default:  false,
    },
    scope: {
      type:     "text",
      label:    "Optional space path (e.g. \"/library\") to scope this branch to a subtree. Writes outside the subtree refuse with SCOPE_VIOLATION; reads outside inherit from parent. Use when experimenting on one feature without contaminating the rest of the reality.",
      required: false,
    },
  },
  handler: async ({ params, identity, moment }) => {
    const parent  = String(params?.parent || MAIN).trim() || MAIN;
    const label   = params?.label ? String(params.label).trim() : null;
    const pointerName = params?.pointer
      ? String(params.pointer).trim().toLowerCase()
      : null;
    if (pointerName && !isPointerName(pointerName)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `create-branch: pointer "${pointerName}" is invalid. ` +
        `Must start with a lowercase letter, end with a letter or digit, ` +
        `and contain only lowercase letters, digits, and single hyphens. ` +
        `Max ${POINTER_NAME_MAX_LENGTH} chars.`);
    }
    const anchor  = {};
    if (typeof params?.atSeq === "number") {
      anchor.atSeq = params.atSeq;
    } else if (typeof params?.atSeq === "string" && params.atSeq.trim().length > 0) {
      const n = Number(params.atSeq);
      if (!Number.isInteger(n) || n < 0) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `create-branch: atSeq must be a non-negative integer; got "${params.atSeq}"`);
      }
      anchor.atSeq = n;
    }
    if (typeof params?.atTimestamp === "string" && params.atTimestamp.trim().length > 0) {
      const d = new Date(params.atTimestamp);
      if (Number.isNaN(d.getTime())) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          `create-branch: invalid atTimestamp "${params.atTimestamp}"`);
      }
      anchor.atTimestamp = d.toISOString();
    }
    if (anchor.atSeq == null && anchor.atTimestamp == null) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        "create-branch: provide atSeq or atTimestamp to anchor the branch point");
    }

    let scopePath = params?.scope ? String(params.scope).trim() : null;
    if (scopePath && !scopePath.startsWith("/")) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `create-branch: scope must be a path starting with "/" (e.g. "/library"); got "${scopePath}"`);
    }
    // "~" is the caller's home — a self-relative alias. The scope
    // walker (resolvePathToSpaceId) resolves real space NAMES from the
    // reality root and can't see aliases, and the scope locks at
    // creation, so the stored path must be canonical. Swap the alias
    // for the home space's real path before resolution.
    if (scopePath && (scopePath === "/~" || scopePath.startsWith("/~/"))) {
      if (!identity?.beingId) {
        throw new IbpError(IBP_ERR.UNAUTHORIZED,
          `create-branch: scope "~" is self-relative and needs a caller identity to resolve a home`);
      }
      const { resolveStance } = await import("../../../ibp/resolver.js");
      const home = await resolveStance(
        { reality: null, path: "/~", being: null, branch: parent },
        { identity },
      );
      const homeName = home?.leafSpace?.name;
      if (!homeName) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND,
          `create-branch: could not resolve "~" to your home space`);
      }
      scopePath = `/${homeName}${scopePath.slice(2)}`;
    }

    // Pointer-collision check BEFORE we create the branch, so a taken
    // pointer refuses cleanly instead of leaving a branch behind. A
    // pointer maps name → exactly one branch path; reassigning moves it
    // (the old branch keeps its canonical path, just loses the pointer).
    const reassignPointer = params?.reassignPointer === true;
    if (pointerName) {
      const existingPointers = await readPointers();
      const heldBy = existingPointers?.[pointerName];
      if (heldBy && !reassignPointer) {
        throw new IbpError(
          IBP_ERR.RESOURCE_CONFLICT,
          `Pointer "${pointerName}" is already on branch #${heldBy}. ` +
          `Pass reassignPointer:true to move it to the new branch.`,
          { pointer: pointerName, heldBy, reassignable: true },
        );
      }
    }

    let result;
    try {
      result = await createBranch({
        parent,
        anchor,
        label,
        createdBy: identity?.beingId || null,
        scope: scopePath ? { path: scopePath } : null,
      });
    } catch (err) {
      // Path / lineage / arg errors surface as INVALID_INPUT; anything
      // else bubbles as INTERNAL.
      if (/invalid|required|not found/i.test(err.message)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, `create-branch: ${err.message}`);
      }
      throw err;
    }

    // Optional inline pointer attach. Stamps the same set-space fact
    // the standalone set-pointer op would, so the front-end can issue
    // one call instead of two.
    let pointerAttached = null;
    let pointerWarning = null;
    if (pointerName) {
      try {
        const current = await readPointers();
        const next = { ...current, [pointerName]: result.path };
        const branchesSpaceId = await findPointersSpaceId();
        if (!branchesSpaceId) {
          pointerWarning = ".branches heaven space not found; pointer attach skipped";
        } else {
          await doVerb(
            { kind: "space", id: branchesSpaceId },
            "set-space",
            { field: "qualities.pointers", value: next, merge: false },
            { identity, moment },
          );
          pointerAttached = pointerName;
        }
      } catch (err) {
        pointerWarning = err.message;
      }
    }

    // Auto-spawn a portal Matter at the reality root on main pointing
    // at the new branch's root. Lets viewers on main peek into every
    // branch as a portal-window without manually issuing form-portal
    // for each one. Target uses the trailing-slash form
    // `<reality>#<branch>/` meaning "the root of that world" — the
    // resolver treats path segments as space NAMES, so passing a
    // UUID here would throw "Segment X not found." Best-effort;
    // branch creation succeeds even if the portal spawn fails. See
    // CROSS-WORLD.md + portalOp.js.
    let portalSpawned = null;
    try {
      const { findRoot } = await import("../../../materials/projections.js");
      const { getRealityDomain } = await import("../../../ibp/address.js");
      const rootSpaces = await findRoot("space", "0");
      const rootSpace = rootSpaces?.[0] || null;
      if (rootSpace) {
        const foreignAddress = `${getRealityDomain()}#${result.path}/`;
        await doVerb(
          { kind: "space", id: String(rootSpace.id) },
          "form-portal",
          { target: foreignAddress, name: `Branch #${result.path}` },
          { identity, moment, currentBranch: "0" },
        );
        portalSpawned = foreignAddress;
      }
    } catch (err) {
      // Auto-portal is convenience, not correctness — leave a soft
      // warning on the response so the caller can re-run form-portal
      // manually if they care.
      // eslint-disable-next-line no-console
      console.warn(`branch-manager: auto-portal for #${result.path} failed: ${err.message}`);
    }

    const response = {
      created:     true,
      path:        result.path,
      parent:      result.parent,
      anchor:      result.anchor,
      branchPoint: result.branchPoint,
      createdAt:   result.createdAt,
    };
    if (pointerAttached) response.pointerAttached = pointerAttached;
    if (pointerWarning) response.pointerWarning = pointerWarning;
    if (scopePath) response.scope = { path: scopePath };
    if (portalSpawned) response.portalSpawned = portalSpawned;
    return response;
  },
});

// pause-branch / unpause-branch — toggle the Branch row's paused
// state. Paused branches refuse DO/BE/SUMMON at the wire-layer gate
// (see protocols/ibp/verbs/* — they read isPaused and throw
// REALITY_PAUSED). SEEs still work so the user can rewind or inspect
// frozen state.
//
// Pause metadata lives on the Branch row directly today; the doc's
// header notes the eventual fact-driven version. For now this is a
// direct write — the substrate doctrine says branch metadata is
// world data, but the reducer + reel haven't shipped yet (Pass 6.5).
// Treat this as the stable public API regardless: callers see ops,
// not collection mutations.

registerOperation("pause-branch", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    branch: {
      type:        "text",
      label:       "Branch path to pause (\"0\" for main; \"1\", \"1a\", etc.)",
      required:    true,
    },
    reason: {
      type:     "text",
      label:    "Optional reason recorded with the pause",
      required: false,
    },
  },
  handler: async ({ params, identity, moment }) => {
    const branchPath = String(params?.branch || "").trim();
    if (!branchPath) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "pause-branch: branch is required");
    }
    // Main IS pauseable. Doctrine (Tabor 2026-06-04): every branch is
    // symmetric; main is not privileged. The "how do you unpause if
    // everything is paused?" recovery is solved by the gate exempting
    // unpause-branch and create-branch — those run on any branch
    // regardless of pause state. So a fully-frozen reality can always
    // be revived. If main doesn't yet have a Branch row, upsert one
    // (rows are normally only created at branch creation; main is
    // implicit because its lineage walk starts from "0" without a
    // backing doc).
    const isMainBranch = branchPath === MAIN;
    if (!isMainBranch) {
      const existing = await Branch.findOne({ path: branchPath }).lean();
      if (!existing) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `pause-branch: no branch "${branchPath}"`);
      }
      if (existing.paused) {
        return { paused: true, path: branchPath, alreadyPaused: true };
      }
    } else {
      const existing = await Branch.findOne({ path: MAIN }).lean();
      if (existing?.paused) {
        return { paused: true, path: MAIN, alreadyPaused: true };
      }
    }
    await Branch.updateOne(
      { path: branchPath },
      {
        $set: {
          paused:   true,
          pausedBy: identity?.beingId || null,
          pausedAt: new Date(),
          ...(params?.reason ? { archivedBecause: String(params.reason) } : {}),
        },
        $setOnInsert: {
          _id:    branchPath,
          path:   branchPath,
          parent: isMainBranch ? null : undefined,
        },
      },
      { upsert: true },
    );
    invalidateBranchCache(branchPath);
    return { paused: true, path: branchPath };
  },
});

registerOperation("unpause-branch", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    branch: {
      type:        "text",
      label:       "Branch path to unpause",
      required:    true,
    },
  },
  handler: async ({ params, identity }) => {
    const branchPath = String(params?.branch || "").trim();
    if (!branchPath) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "unpause-branch: branch is required");
    }
    const row = await Branch.findOne({ path: branchPath }).lean();
    if (!row) {
      // No row = not paused (main without a row is the implicit-live
      // default). Treat as alreadyLive idempotently.
      return { paused: false, path: branchPath, alreadyLive: true };
    }
    if (!row.paused) {
      return { paused: false, path: branchPath, alreadyLive: true };
    }
    await Branch.updateOne(
      { path: branchPath },
      {
        $set: { paused: false, pausedAt: null, pausedBy: null, archivedBecause: null },
      },
    );
    invalidateBranchCache(branchPath);
    return { paused: false, path: branchPath };
  },
});

// delete-branch / undelete-branch . mark-deleted toggle on the Branch
// row. Mirrors pause/unpause structurally. Soft delete by doctrine:
// every other lifecycle op in TreeOS is append-only (beings are
// released not erased, spaces are archived not erased), so branches
// follow the same shape. The chain preserves the fact that a branch
// existed and was deleted at T. Undelete is one toggle away.
//
// Deleted branches refuse DO/BE/SUMMON at the wire-layer gate (see
// protocols/ibp/verbs/*) and at the scheduler intake gate. SEE stays
// open so historians can still walk the chain. Branch listings filter
// out deleted by default; the catalog still surfaces a specific
// deleted branch if its path is asked for directly.
//
// Main IS deletable (symmetric-branch doctrine; same as pause). The
// gates exempt undelete-branch and delete-branch themselves so a
// fully-deleted reality can always be revived.

registerOperation("delete-branch", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    branch: {
      type:        "text",
      label:       "Branch path to delete (\"0\" for main; \"1\", \"1a\", etc.)",
      required:    true,
    },
    reason: {
      type:     "text",
      label:    "Optional reason recorded with the deletion",
      required: false,
    },
  },
  handler: async ({ params, identity }) => {
    const branchPath = String(params?.branch || "").trim();
    if (!branchPath) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-branch: branch is required");
    }
    const isMainBranch = branchPath === MAIN;
    if (!isMainBranch) {
      const existing = await Branch.findOne({ path: branchPath }).lean();
      if (!existing) {
        throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `delete-branch: no branch "${branchPath}"`);
      }
      if (existing.deleted) {
        return { deleted: true, path: branchPath, alreadyDeleted: true };
      }
    } else {
      const existing = await Branch.findOne({ path: MAIN }).lean();
      if (existing?.deleted) {
        return { deleted: true, path: MAIN, alreadyDeleted: true };
      }
    }
    await Branch.updateOne(
      { path: branchPath },
      {
        $set: {
          deleted:   true,
          deletedBy: identity?.beingId || null,
          deletedAt: new Date(),
          ...(params?.reason ? { archivedBecause: String(params.reason) } : {}),
        },
        $setOnInsert: {
          _id:    branchPath,
          path:   branchPath,
          parent: isMainBranch ? null : undefined,
        },
      },
      { upsert: true },
    );
    invalidateBranchCache(branchPath);
    return { deleted: true, path: branchPath };
  },
});

registerOperation("undelete-branch", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    branch: {
      type:        "text",
      label:       "Branch path to undelete",
      required:    true,
    },
  },
  handler: async ({ params }) => {
    const branchPath = String(params?.branch || "").trim();
    if (!branchPath) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "undelete-branch: branch is required");
    }
    const row = await Branch.findOne({ path: branchPath }).lean();
    if (!row) {
      return { deleted: false, path: branchPath, alreadyLive: true };
    }
    if (!row.deleted) {
      return { deleted: false, path: branchPath, alreadyLive: true };
    }
    await Branch.updateOne(
      { path: branchPath },
      {
        $set: { deleted: false, deletedAt: null, deletedBy: null },
      },
    );
    invalidateBranchCache(branchPath);
    return { deleted: false, path: branchPath };
  },
});

// merge-branches . combine two source branches into a third.
//
// Doctrine (see [seed/timeline.md](seed/timeline.md) "merging"):
// merging is creation, not modification. A merge produces a third
// branch whose parent is the common ancestor of sourceA and sourceB,
// with its branchPoint snapshotting the ancestor's current state.
// Reconciliation facts stamped on the merged branch bring its state
// to the user-resolved combined state. The source branches stay
// immutable.
//
// The merged branch starts live (unpaused). Reconciliation happens
// via normal DO ops; each reconciliation fact carries `params._merge`
// for forensic audit. The `merge-mediator` role provides the UX layer
// that walks an operator through conflicts (Phase 6 in the merge arc).
//
// V1 handles two-source merges. Multi-source merges (N>2) are
// possible by chaining merges (merge A+B into C, then merge C+D into
// E) but are not a single-op primitive.
//
// V1 does NOT detect cascade conflicts (a resolution on reel X
// invalidating a chosen state on reel Y). Per-reel independent
// conflicts only; the mediator + operator handle cascades by hand.

registerOperation("merge-branches", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    sourceA: {
      type:     "text",
      label:    "First source branch path (e.g. \"1\", \"1a\")",
      required: true,
    },
    sourceB: {
      type:     "text",
      label:    "Second source branch path",
      required: true,
    },
    label: {
      type:     "text",
      label:    "Label for the merged branch (optional human-readable name)",
      required: false,
    },
    afterAction: {
      type:     "text",
      label:    "What to do with sourceA and sourceB after merge: \"keep\" (default), \"pause\", or \"delete\". Pause stops them from ticking but keeps them readable; delete marks them deleted (still soft, still in the chain).",
      required: false,
      default:  "keep",
    },
    repointPointers: {
      type:     "text",
      label:    "Comma-separated list of named pointers (e.g. \"main,prod\") to re-point at the merged branch in one call. Each name must match the pointer grammar (lowercase letter start). Updates land via the .branches heaven space's qualities.pointers.",
      required: false,
    },
    pauseResult: {
      type:     "text",
      label:    "Pause the merged branch immediately after creation (\"true\" or \"false\", default \"false\"). Useful when conflicts need resolution before the branch should be live. Operators unpause via pause-branch op when ready.",
      required: false,
      default:  "false",
    },
  },
  handler: async ({ params, identity, moment }) => {
    const sourceA = String(params?.sourceA || "").trim();
    const sourceB = String(params?.sourceB || "").trim();
    const label   = params?.label ? String(params.label).trim() : null;
    const afterAction = String(params?.afterAction || "keep").trim().toLowerCase();
    const VALID_AFTER = new Set(["keep", "pause", "delete"]);
    if (!VALID_AFTER.has(afterAction)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `merge-branches: afterAction must be one of: ${[...VALID_AFTER].join(", ")}; got "${afterAction}"`);
    }
    const pauseResult = (() => {
      const raw = params?.pauseResult;
      if (raw === true) return true;
      if (typeof raw === "string") return raw.trim().toLowerCase() === "true";
      return false;
    })();
    if (!sourceA) throw new IbpError(IBP_ERR.INVALID_INPUT, "merge-branches: sourceA is required");
    if (!sourceB) throw new IbpError(IBP_ERR.INVALID_INPUT, "merge-branches: sourceB is required");
    if (sourceA === sourceB) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        "merge-branches: sourceA and sourceB must differ");
    }

    // Find the common ancestor. Walks both lineages; throws if either
    // path doesn't resolve (e.g., the row is gone).
    let ancestor;
    try {
      ancestor = await commonAncestor(sourceA, sourceB);
    } catch (err) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `merge-branches: ${err.message}`);
    }

    // Refuse degenerate merges where one source is the ancestor of
    // the other. In that case the "merged" branch would just be a
    // copy of the deeper source; no merge work to do. Operators who
    // want that effect should just navigate to the deeper source.
    if (ancestor === sourceA || ancestor === sourceB) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `merge-branches: "${ancestor}" is an ancestor of the other source. ` +
        `Nothing to merge.`);
    }

    // Snapshot the ancestor's current heads. Each reel's branchPoint
    // becomes its current max seq, so the merged branch inherits the
    // full state at the ancestor as of right now. createBranch's
    // snapshotParentHeads uses atSeq as $lte on the seq filter; a
    // very large value catches every existing fact on the ancestor's
    // lineage.
    let result;
    try {
      result = await createBranch({
        parent:    ancestor,
        anchor:    { atSeq: Number.MAX_SAFE_INTEGER },
        label,
        createdBy: identity?.beingId || null,
      });
    } catch (err) {
      if (/invalid|required|not found/i.test(err.message)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, `merge-branches: ${err.message}`);
      }
      throw err;
    }

    // Stamp the merge provenance onto the new Branch row. mergeSources
    // is forensic; the canonical `parent` stays the common ancestor.
    await Branch.updateOne(
      { path: result.path },
      { $set: { mergeSources: [sourceA, sourceB] } },
    );
    invalidateBranchCache(result.path);

    // Reset reels: state that's branch-private by nature (today,
    // inhabit-state) is reset on the merged branch so divergent
    // source states don't collide. Each reset stamps a fact with
    // params._merge for forensic audit.
    let resetCount = 0;
    let resetWarning = null;
    try {
      const actorBeingId = identity?.beingId;
      if (actorBeingId) {
        const resetFacts = await computeMergeResetFacts({
          mergedBranch: result.path,
          ancestor,
          actorBeingId,
        });
        for (const spec of resetFacts) {
          await emitFact(spec, moment);
        }
        resetCount = resetFacts.length;
      }
    } catch (err) {
      // Reset failures don't roll back the merged branch (the branch
      // and the resets are conceptually separate). Surface as part of
      // the response so the operator can investigate.
      resetWarning = err.message;
    }

    // afterAction: optionally pause or delete the source branches so
    // the front-end can wire "auto-tidy after merge" through one op
    // call. Failures here don't roll back the merged branch . the
    // merge already succeeded; this is housekeeping. Failures surface
    // as a warning.
    const sourcesAffected = [];
    let afterWarning = null;
    if (afterAction !== "keep") {
      try {
        for (const branchPath of [sourceA, sourceB]) {
          if (afterAction === "pause") {
            await Branch.updateOne(
              { path: branchPath },
              {
                $set: {
                  paused:   true,
                  pausedBy: identity?.beingId || null,
                  pausedAt: new Date(),
                  archivedBecause: `paused after merge into ${result.path}`,
                },
                $setOnInsert: {
                  _id:    branchPath,
                  path:   branchPath,
                  parent: branchPath === MAIN ? null : undefined,
                },
              },
              { upsert: true },
            );
          } else if (afterAction === "delete") {
            await Branch.updateOne(
              { path: branchPath },
              {
                $set: {
                  deleted:   true,
                  deletedBy: identity?.beingId || null,
                  deletedAt: new Date(),
                  archivedBecause: `deleted after merge into ${result.path}`,
                },
                $setOnInsert: {
                  _id:    branchPath,
                  path:   branchPath,
                  parent: branchPath === MAIN ? null : undefined,
                },
              },
              { upsert: true },
            );
          }
          invalidateBranchCache(branchPath);
          sourcesAffected.push(branchPath);
        }
      } catch (err) {
        afterWarning = err.message;
      }
    }

    // repointPointers: optional. Accepts a comma-separated list or
    // an array. Each named pointer gets repointed at the merged
    // branch in a single set-being write to the @branch-registry
    // being's qualities.pointers map.
    let pointersRepointed = [];
    let repointWarning = null;
    const repointArg = params?.repointPointers;
    let pointerNames = [];
    if (Array.isArray(repointArg)) {
      pointerNames = repointArg.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    } else if (typeof repointArg === "string" && repointArg.trim().length > 0) {
      pointerNames = repointArg.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    }
    if (pointerNames.length > 0) {
      for (const name of pointerNames) {
        if (!isPointerName(name)) {
          throw new IbpError(IBP_ERR.INVALID_INPUT,
            `merge-branches: repointPointers entry "${name}" is invalid. ` +
            `Pointer names must start with a lowercase letter, end with a letter or digit, ` +
            `contain only lowercase letters, digits, and single hyphens, ` +
            `and be at most ${POINTER_NAME_MAX_LENGTH} chars.`);
        }
      }
      try {
        const current = await readPointers();
        const next = { ...current };
        for (const name of pointerNames) next[name] = result.path;
        const branchesSpaceId = await findPointersSpaceId();
        if (!branchesSpaceId) {
          repointWarning = ".branches heaven space not found; pointer updates skipped";
        } else {
          await doVerb(
            { kind: "space", id: branchesSpaceId },
            "set-space",
            { field: "qualities.pointers", value: next, merge: false },
            { identity, moment },
          );
          pointersRepointed = pointerNames;
        }
      } catch (err) {
        repointWarning = err.message;
      }
    }

    // Surface source-branch pointers so the front-end can ask "this
    // branch had #feature-x attached . want to move it to the merged
    // branch, delete it, or leave it pointing at the now-historical
    // source?" Reverse lookup runs against the live pointer map.
    const [sourceAPointers, sourceBPointers] = await Promise.all([
      pointersFor(sourceA),
      pointersFor(sourceB),
    ]);

    // pauseResult: freeze the merged branch immediately so operators
    // can resolve conflicts before its scheduler starts ticking and
    // the state drifts from whatever they decide. Unpause via
    // pause-branch when ready. Failures here are non-fatal . the
    // merge succeeded; the freeze is housekeeping.
    let resultPaused = false;
    let pauseResultWarning = null;
    if (pauseResult) {
      try {
        await Branch.updateOne(
          { path: result.path },
          {
            $set: {
              paused:   true,
              pausedBy: identity?.beingId || null,
              pausedAt: new Date(),
              archivedBecause: `paused for conflict resolution after merge of #${sourceA} + #${sourceB}`,
            },
          },
        );
        invalidateBranchCache(result.path);
        resultPaused = true;
      } catch (err) {
        pauseResultWarning = err.message;
      }
    }

    const response = {
      merged:       true,
      path:         result.path,
      parent:       result.parent,
      ancestor,
      mergeSources: [sourceA, sourceB],
      branchPoint:  result.branchPoint,
      createdAt:    result.createdAt,
      resetCount,
      afterAction,
      sourcesAffected,
      pointersRepointed,
      sourceAPointers,
      sourceBPointers,
      resultPaused,
    };
    if (resetWarning) response.resetWarning = resetWarning;
    if (afterWarning) response.afterWarning = afterWarning;
    if (repointWarning) response.repointWarning = repointWarning;
    if (pauseResultWarning) response.pauseResultWarning = pauseResultWarning;
    return response;
  },
});

// list-branches lived here briefly as a DO op. Retired 2026-06-02: the
// read-only graph belongs on a synthetic SEE catalog
// (`<reality>/.branches[/<path>]`), not a DO op. DOs open transport-act
// moments that go through the scheduler and the orphan-act seal guard —
// neither of which a read-only query should be paying for. The catalog
// helper lives at seed/materials/branch/branchesCatalog.js and is
// wired into seed/ibp/verbs/see.js.

// set-pointer / delete-pointer . named-pointer registry management.
//
// The pointer map lives on the `.branches` heaven space's
// qualities.pointers. The IBP address parser resolves named pointers
// (#main, #prod) through this map via resolveBranchPointers (the
// wire-layer async step). Canonical paths (#0, #1a2) bypass.
//
// These ops were briefly hosted on a dedicated @branch-registry
// delegate; retired 2026-06-04 when "heaven never branches" landed.
// The storage is heaven; the ops live with the branch-manager
// workflow they participate in (merging frequently re-points main).

// set-pointer's world strand is branch-manager.word (the gate chain), run through the
// bridge in CALLER mode (no `through` — the pointer write attributes to the setter). The
// heaven reads + the lone set-space stay host. Returns {set,name,canonical,previous}, or
// null on a clean miss so the JS body below runs.
async function _setPointerViaWord({ caller, name, canonical, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../word/roleWordRegistry.js");
  const ir = resolveRoleWord("branch-manager", "set-pointer", moment?.actorAct?.branch);
  if (!ir) return null;
  const { branchManagerHostEnv } = await import("./branchManagerHost.js");
  const branch = moment?.actorAct?.branch || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { caller: caller ? String(caller) : null, name, canonical, branch },
      env: { host: branchManagerHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("set-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: {
      type:     "text",
      label:    "Pointer name (e.g. \"main\", \"prod\", \"release-v2\")",
      required: true,
    },
    canonical: {
      type:     "text",
      label:    "Canonical branch path the pointer should resolve to (e.g. \"0\", \"7\", \"1a2\")",
      required: true,
    },
  },
  handler: async ({ params, identity, moment }) => {
    // THE CONVERSION: prefer the bridge; the JS below is the clean-miss fallback.
    const viaWord = await _setPointerViaWord({ caller: identity?.beingId, name: params?.name, canonical: params?.canonical, moment });
    if (viaWord) return viaWord;

    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED,
        "set-pointer requires an authenticated being");
    }
    const name = String(params?.name || "").trim().toLowerCase();
    const canonical = String(params?.canonical || "").trim();
    if (!isPointerName(name)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `set-pointer: name "${name}" is invalid. ` +
        `Must start with a lowercase letter, end with a letter or digit, ` +
        `and contain only lowercase letters, digits, and single hyphens ` +
        `(no consecutive or trailing hyphens). Max ${POINTER_NAME_MAX_LENGTH} chars.`);
    }
    if (!CANONICAL_PATH_RE.test(canonical)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `set-pointer: canonical "${canonical}" is not a structurally valid path (expected "0", "1", "1a", "7b3", etc.)`);
    }

    const current = await readPointers();
    const next = { ...current, [name]: canonical };

    const branchesSpaceId = await findPointersSpaceId();
    if (!branchesSpaceId) {
      throw new IbpError(IBP_ERR.INTERNAL,
        "set-pointer: .branches heaven space not found . reality is not properly bootstrapped");
    }
    await doVerb(
      { kind: "space", id: branchesSpaceId },
      "set-space",
      { field: "qualities.pointers", value: next, merge: false },
      { identity, moment },
    );

    log.verbose("branch-manager",
      `set-pointer #${name} → #${canonical} (by ${identity.beingId.slice(0, 8)})`);
    return { set: true, name, canonical, previous: current[name] || null };
  },
});

// delete-pointer's world strand is delete-pointer.word (the gate chain), run through the
// bridge in CALLER mode. The heaven read + the lone pointer-map set-space stay host.
// Returns {name, deleted, alreadyAbsent} or null on a clean miss so the JS body runs.
async function _deletePointerViaWord({ caller, name, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../word/roleWordRegistry.js");
  const ir = resolveRoleWord("branch-manager", "delete-pointer", moment?.actorAct?.branch);
  if (!ir) return null;
  const { branchManagerHostEnv } = await import("./branchManagerHost.js");
  const branch = moment?.actorAct?.branch;
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { caller: caller ? String(caller) : null, name, branch },
      env: { host: branchManagerHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("delete-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: {
      type:     "text",
      label:    "Pointer name to delete",
      required: true,
    },
  },
  handler: async ({ params, identity, moment }) => {
    // THE CONVERSION: prefer the bridge; the JS below is the clean-miss fallback.
    const viaWord = await _deletePointerViaWord({ caller: identity?.beingId, name: params?.name, moment });
    if (viaWord) return viaWord;

    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED,
        "delete-pointer requires an authenticated being");
    }
    const name = String(params?.name || "").trim().toLowerCase();
    if (!isPointerName(name)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `delete-pointer: name "${name}" is invalid. ` +
        `Must start with a lowercase letter, end with a letter or digit, ` +
        `and contain only lowercase letters, digits, and single hyphens. ` +
        `Max ${POINTER_NAME_MAX_LENGTH} chars.`);
    }
    if (RESERVED_POINTERS.includes(name)) {
      throw new IbpError(IBP_ERR.FORBIDDEN,
        `delete-pointer: "${name}" is reserved and cannot be deleted. Re-point it via set-pointer instead.`);
    }

    const current = await readPointers();
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      return { deleted: false, name, alreadyAbsent: true };
    }
    const next = { ...current };
    delete next[name];

    const branchesSpaceId = await findPointersSpaceId();
    if (!branchesSpaceId) {
      throw new IbpError(IBP_ERR.INTERNAL,
        "delete-pointer: .branches heaven space not found");
    }
    await doVerb(
      { kind: "space", id: branchesSpaceId },
      "set-space",
      { field: "qualities.pointers", value: next, merge: false },
      { identity, moment },
    );

    log.verbose("branch-manager",
      `delete-pointer #${name} (by ${identity.beingId.slice(0, 8)})`);
    return { deleted: true, name };
  },
});
