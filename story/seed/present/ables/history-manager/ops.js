// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// history-manager ops. The DO operations the @history-manager delegate
// exposes for history lifecycle.
//
// One op for Pass 3: `create-history`. Forks a new world from a past
// point of an existing history. The substrate's createBranch helper
// does the heavy lifting (path arithmetic, branchPoint snapshot,
// History row, child space).
//
// Auth: any heaven authority (hasAccess on heaven) can mint a history off any history they can
// SEE. Promotion to live / pause / delete (Pass 6.5 + 10) require
// tighter permissions; for history creation, the principle is "anyone
// who can read can fork" — histories are isolated worlds, the parent
// is unaffected.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { createBranch } from "../../../materials/history/historyCreation.js";
import {
  MAIN,
  invalidateHistoryCache,
  commonAncestor,
} from "../../../materials/history/histories.js";
import History from "../../../materials/history/history.js";
import { computeMergeResetFacts } from "../../../materials/history/resetReels.js";
import { emitFact } from "../../../past/fact/facts.js";
import {
  readPointers,
  POINTER_NAME_RE,
  POINTER_NAME_MAX_LENGTH,
  findPointersSpaceId,
  pointersFor,
  isPointerName,
} from "../../../materials/history/historyRegistry.js";
import { doVerb } from "../../../ibp/verbs/do.js";

export function registerHistoryManagerOps() {
  // The actual registerOperation call lives at module load (side
  // effect); this empty function is the explicit entry point so
  // genesis.js can import + call it the same way it does for
  // able-manager / llm-assigner.
}

registerOperation("create-branch", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    parent: {
      type: "text",
      label:
        'Parent history path (e.g. "0" for main, "1a" for a nested history)',
      required: false,
      default: MAIN,
    },
    atSeq: {
      type: "number",
      label:
        "History from this seq on the parent's reel (substrate-native; preferred when known)",
      required: false,
    },
    atTimestamp: {
      type: "text",
      label:
        "History from this ISO timestamp (human helper; resolved per-reel)",
      required: false,
    },
    label: {
      type: "text",
      label: "Label (optional human-readable name)",
      required: false,
    },
    pointer: {
      type: "text",
      label:
        'Optional named pointer to attach to the new branch in the same call (e.g. "feature-x"). Equivalent to following create-branch with set-pointer.',
      required: false,
    },
    reassignPointer: {
      type: "bool",
      label:
        "If the pointer is already taken, move it to the new branch (the old branch keeps its canonical path but loses the pointer). Without this, a taken pointer is refused.",
      required: false,
      default: false,
    },
    scope: {
      type: "text",
      label:
        'Optional space path (e.g. "/library") to scope this branch to a subtree. Writes outside the subtree refuse with SCOPE_VIOLATION; reads outside inherit from parent. Use when experimenting on one feature without contaminating the rest of the story.',
      required: false,
    },
  },
  handler: async ({ params, identity, moment }) => {
    const parent = String(params?.parent || MAIN).trim() || MAIN;
    const label = params?.label ? String(params.label).trim() : null;
    const pointerName = params?.pointer
      ? String(params.pointer).trim().toLowerCase()
      : null;
    if (pointerName && !isPointerName(pointerName)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `create-branch: pointer "${pointerName}" is invalid. ` +
          `Must start with a lowercase letter, end with a letter or digit, ` +
          `and contain only lowercase letters, digits, and single hyphens. ` +
          `Max ${POINTER_NAME_MAX_LENGTH} chars.`,
      );
    }
    const anchor = {};
    if (typeof params?.atSeq === "number") {
      anchor.atSeq = params.atSeq;
    } else if (
      typeof params?.atSeq === "string" &&
      params.atSeq.trim().length > 0
    ) {
      const n = Number(params.atSeq);
      if (!Number.isInteger(n) || n < 0) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `create-branch: atSeq must be a non-negative integer; got "${params.atSeq}"`,
        );
      }
      anchor.atSeq = n;
    }
    if (
      typeof params?.atTimestamp === "string" &&
      params.atTimestamp.trim().length > 0
    ) {
      const d = new Date(params.atTimestamp);
      if (Number.isNaN(d.getTime())) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `create-branch: invalid atTimestamp "${params.atTimestamp}"`,
        );
      }
      anchor.atTimestamp = d.toISOString();
    }
    if (anchor.atSeq == null && anchor.atTimestamp == null) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "create-branch: provide atSeq or atTimestamp to anchor the branch point",
      );
    }

    let scopePath = params?.scope ? String(params.scope).trim() : null;
    if (scopePath && !scopePath.startsWith("/")) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `create-branch: scope must be a path starting with "/" (e.g. "/library"); got "${scopePath}"`,
      );
    }
    // "~" is the caller's home — a self-relative alias. The scope
    // walker (resolvePathToSpaceId) resolves real space NAMES from the
    // story root and can't see aliases, and the scope locks at
    // creation, so the stored path must be canonical. Swap the alias
    // for the home space's real path before resolution.
    if (scopePath && (scopePath === "/~" || scopePath.startsWith("/~/"))) {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          `create-branch: scope "~" is self-relative and needs a caller identity to resolve a home`,
        );
      }
      const { resolveStance } = await import("../../../ibp/resolver.js");
      const home = await resolveStance(
        { story: null, path: "/~", being: null, history: parent },
        { identity },
      );
      const homeName = home?.leafSpace?.name;
      if (!homeName) {
        throw new IbpError(
          IBP_ERR.SPACE_NOT_FOUND,
          `create-branch: could not resolve "~" to your home space`,
        );
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
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `create-branch: ${err.message}`,
        );
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
        const historiesSpaceId = await findPointersSpaceId();
        if (!historiesSpaceId) {
          pointerWarning =
            ".histories heaven space not found; pointer attach skipped";
        } else {
          await doVerb(
            { kind: "space", id: historiesSpaceId },
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

    // Auto-spawn a portal Matter at the story root on main pointing
    // at the new history's root. Lets viewers on main peek into every
    // history as a portal-window without manually issuing form-portal
    // for each one. Target uses the trailing-slash form
    // `<story>#<history >/` meaning "the root of that world" — the
    // resolver treats path segments as space NAMES, so passing a
    // UUID here would throw "Segment X not found." Best-effort;
    // history creation succeeds even if the portal spawn fails. See
    // CROSS-WORLD.md + portalOp.js.
    let portalSpawned = null;
    try {
      const { findRoot } = await import("../../../materials/projections.js");
      const { getStoryDomain } = await import("../../../ibp/address.js");
      const rootSpaces = await findRoot("space", "0");
      const rootSpace = rootSpaces?.[0] || null;
      if (rootSpace) {
        const foreignAddress = `${getStoryDomain()}#${result.path}/`;
        await doVerb(
          { kind: "space", id: String(rootSpace.id) },
          "form-portal",
          { target: foreignAddress, name: `History #${result.path}` },
          { identity, moment, currentHistory: "0" },
        );
        portalSpawned = foreignAddress;
      }
    } catch (err) {
      // Auto-portal is convenience, not correctness — leave a soft
      // warning on the response so the caller can re-run form-portal
      // manually if they care.
      // eslint-disable-next-line no-console
      console.warn(
        `history-manager: auto-portal for #${result.path} failed: ${err.message}`,
      );
    }

    const response = {
      created: true,
      path: result.path,
      parent: result.parent,
      anchor: result.anchor,
      branchPoint: result.branchPoint,
      createdAt: result.createdAt,
    };
    if (pointerAttached) response.pointerAttached = pointerAttached;
    if (pointerWarning) response.pointerWarning = pointerWarning;
    if (scopePath) response.scope = { path: scopePath };
    if (portalSpawned) response.portalSpawned = portalSpawned;
    return response;
  },
});

// pause-history / unpause-history — toggle the History row's paused
// state. Paused histories refuse DO/BE/SUMMON at the wire-layer gate
// (see protocols/ibp/verbs/* — they read isPaused and throw
// STORY_PAUSED). SEEs still work so the user can rewind or inspect
// frozen state.
//
// Pause metadata lives on the History row directly today; the doc's
// header notes the eventual fact-driven version. For now this is a
// direct write — the substrate doctrine says history metadata is
// world data, but the reducer + reel haven't shipped yet (Pass 6.5).
// Treat this as the stable public API regardless: callers see ops,
// not collection mutations.

registerOperation("pause-history", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    history: {
      type: "text",
      label: 'History path to pause ("0" for main; "1", "1a", etc.)',
      required: true,
    },
    reason: {
      type: "text",
      label: "Optional reason recorded with the pause",
      required: false,
    },
  },
  handler: async ({ params, identity, moment }) => {
    const historyPath = String(params?.history || "").trim();
    if (!historyPath) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "pause-history: history is required",
      );
    }
    // Main IS pauseable. Doctrine (Tabor 2026-06-04): every history is
    // symmetric; main is not privileged. The "how do you unpause if
    // everything is paused?" recovery is solved by the gate exempting
    // unpause-history and create-history — those run on any history
    // regardless of pause state. So a fully-frozen story can always
    // be revived. If main doesn't yet have a History row, upsert one
    // (rows are normally only created at history creation; main is
    // implicit because its lineage walk starts from "0" without a
    // backing doc).
    const isMainHistory = historyPath === MAIN;
    if (!isMainHistory) {
      const existing = await History.findOne({ path: historyPath }).lean();
      if (!existing) {
        throw new IbpError(
          IBP_ERR.SPACE_NOT_FOUND,
          `pause-history: no history "${historyPath}"`,
        );
      }
      if (existing.paused) {
        return { paused: true, path: historyPath, alreadyPaused: true };
      }
    } else {
      const existing = await History.findOne({ path: MAIN }).lean();
      if (existing?.paused) {
        return { paused: true, path: MAIN, alreadyPaused: true };
      }
    }
    await History.updateOne(
      { path: historyPath },
      {
        $set: {
          paused: true,
          pausedBy: identity?.beingId || null,
          pausedAt: new Date(),
          ...(params?.reason ? { archivedBecause: String(params.reason) } : {}),
        },
        $setOnInsert: {
          _id: historyPath,
          path: historyPath,
          parent: isMainHistory ? null : undefined,
        },
      },
      { upsert: true },
    );
    invalidateHistoryCache(historyPath);
    return { paused: true, path: historyPath };
  },
});

registerOperation("unpause-history", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    history: {
      type: "text",
      label: "History path to unpause",
      required: true,
    },
  },
  handler: async ({ params, identity }) => {
    const historyPath = String(params?.history || "").trim();
    if (!historyPath) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "unpause-history: history is required",
      );
    }
    const row = await History.findOne({ path: historyPath }).lean();
    if (!row) {
      // No row = not paused (main without a row is the implicit-live
      // default). Treat as alreadyLive idempotently.
      return { paused: false, path: historyPath, alreadyLive: true };
    }
    if (!row.paused) {
      return { paused: false, path: historyPath, alreadyLive: true };
    }
    await History.updateOne(
      { path: historyPath },
      {
        $set: {
          paused: false,
          pausedAt: null,
          pausedBy: null,
          archivedBecause: null,
        },
      },
    );
    invalidateHistoryCache(historyPath);
    return { paused: false, path: historyPath };
  },
});

// delete-history / undelete-history . mark-deleted toggle on the History
// row. Mirrors pause/unpause structurally. Soft delete by doctrine:
// every other lifecycle op in TreeOS is append-only (beings are
// released not erased, spaces are archived not erased), so histories
// follow the same shape. The chain preserves the fact that a history
// existed and was deleted at T. Undelete is one toggle away.
//
// Deleted histories refuse DO/BE/SUMMON at the wire-layer gate (see
// protocols/ibp/verbs/*) and at the scheduler intake gate. SEE stays
// open so historians can still walk the chain. History listings filter
// out deleted by default; the catalog still surfaces a specific
// deleted history  if its path is asked for directly.
//
// Main IS deletable (symmetric-history doctrine; same as pause). The
// gates exempt undelete-history and delete-history themselves so a
// fully-deleted story can always be revived.

registerOperation("delete-history", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    history: {
      type: "text",
      label: 'History path to delete ("0" for main; "1", "1a", etc.)',
      required: true,
    },
    reason: {
      type: "text",
      label: "Optional reason recorded with the deletion",
      required: false,
    },
  },
  handler: async ({ params, identity }) => {
    const historyPath = String(params?.history || "").trim();
    if (!historyPath) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "delete-history: history is required",
      );
    }
    const isMainHistory = historyPath === MAIN;
    if (!isMainHistory) {
      const existing = await History.findOne({ path: historyPath }).lean();
      if (!existing) {
        throw new IbpError(
          IBP_ERR.SPACE_NOT_FOUND,
          `delete-history: no history "${historyPath}"`,
        );
      }
      if (existing.deleted) {
        return { deleted: true, path: historyPath, alreadyDeleted: true };
      }
    } else {
      const existing = await History.findOne({ path: MAIN }).lean();
      if (existing?.deleted) {
        return { deleted: true, path: MAIN, alreadyDeleted: true };
      }
    }
    await History.updateOne(
      { path: historyPath },
      {
        $set: {
          deleted: true,
          deletedBy: identity?.beingId || null,
          deletedAt: new Date(),
          ...(params?.reason ? { archivedBecause: String(params.reason) } : {}),
        },
        $setOnInsert: {
          _id: historyPath,
          path: historyPath,
          parent: isMainHistory ? null : undefined,
        },
      },
      { upsert: true },
    );
    invalidateHistoryCache(historyPath);
    return { deleted: true, path: historyPath };
  },
});

registerOperation("undelete-history", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    history: {
      type: "text",
      label: "History path to undelete",
      required: true,
    },
  },
  handler: async ({ params }) => {
    const historyPath = String(params?.history || "").trim();
    if (!historyPath) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "undelete-history: history is required",
      );
    }
    const row = await History.findOne({ path: historyPath }).lean();
    if (!row) {
      return { deleted: false, path: historyPath, alreadyLive: true };
    }
    if (!row.deleted) {
      return { deleted: false, path: historyPath, alreadyLive: true };
    }
    await History.updateOne(
      { path: historyPath },
      {
        $set: { deleted: false, deletedAt: null, deletedBy: null },
      },
    );
    invalidateHistoryCache(historyPath);
    return { deleted: false, path: historyPath };
  },
});

// merge-histories . combine two source histories into a third.
//
// Doctrine (see [seed/timeline.md](seed/timeline.md) "merging"):
// merging is creation, not modification. A merge produces a third
// history whose parent is the common ancestor of sourceA and sourceB,
// with its historyPoint snapshotting the ancestor's current state.
// Reconciliation facts stamped on the merged history bring its state
// to the user-resolved combined state. The source histories stay
// immutable.
//
// The merged history starts live (unpaused). Reconciliation happens
// via normal DO ops; each reconciliation fact carries `params._merge`
// for forensic audit. The `merge-mediator` able provides the UX layer
// that walks an operator through conflicts (Phase 6 in the merge arc).
//
// V1 handles two-source merges. Multi-source merges (N>2) are
// possible by chaining merges (merge A+B into C, then merge C+D into
// E) but are not a single-op primitive.
//
// V1 does NOT detect cascade conflicts (a resolution on reel X
// invalidating a chosen state on reel Y). Per-reel independent
// conflicts only; the mediator + operator handle cascades by hand.

registerOperation("merge-histories", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    sourceA: {
      type: "text",
      label: 'First source history path (e.g. "1", "1a")',
      required: true,
    },
    sourceB: {
      type: "text",
      label: "Second source history path",
      required: true,
    },
    label: {
      type: "text",
      label: "Label for the merged history (optional human-readable name)",
      required: false,
    },
    afterAction: {
      type: "text",
      label:
        'What to do with sourceA and sourceB after merge: "keep" (default), "pause", or "delete". Pause stops them from ticking but keeps them readable; delete marks them deleted (still soft, still in the chain).',
      required: false,
      default: "keep",
    },
    repointPointers: {
      type: "text",
      label:
        'Comma-separated list of named pointers (e.g. "main,prod") to re-point at the merged history in one call. Each name must match the pointer grammar (lowercase letter start). Updates land via the .histories heaven space\'s qualities.pointers.',
      required: false,
    },
    pauseResult: {
      type: "text",
      label:
        'Pause the merged history immediately after creation ("true" or "false", default "false"). Useful when conflicts need resolution before the history should be live. Operators unpause via pause-history op when ready.',
      required: false,
      default: "false",
    },
  },
  handler: async ({ params, identity, moment }) => {
    const sourceA = String(params?.sourceA || "").trim();
    const sourceB = String(params?.sourceB || "").trim();
    const label = params?.label ? String(params.label).trim() : null;
    const afterAction = String(params?.afterAction || "keep")
      .trim()
      .toLowerCase();
    const VALID_AFTER = new Set(["keep", "pause", "delete"]);
    if (!VALID_AFTER.has(afterAction)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `merge-histories: afterAction must be one of: ${[...VALID_AFTER].join(", ")}; got "${afterAction}"`,
      );
    }
    const pauseResult = (() => {
      const raw = params?.pauseResult;
      if (raw === true) return true;
      if (typeof raw === "string") return raw.trim().toLowerCase() === "true";
      return false;
    })();
    if (!sourceA)
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "merge-histories: sourceA is required",
      );
    if (!sourceB)
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "merge-histories: sourceB is required",
      );
    if (sourceA === sourceB) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "merge-histories: sourceA and sourceB must differ",
      );
    }

    // Find the common ancestor. Walks both lineages; throws if either
    // path doesn't resolve (e.g., the row is gone).
    let ancestor;
    try {
      ancestor = await commonAncestor(sourceA, sourceB);
    } catch (err) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `merge-histories: ${err.message}`,
      );
    }

    // Refuse degenerate merges where one source is the ancestor of
    // the other. In that case the "merged" history would just be a
    // copy of the deeper source; no merge work to do. Operators who
    // want that effect should just navigate to the deeper source.
    if (ancestor === sourceA || ancestor === sourceB) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `merge-histories: "${ancestor}" is an ancestor of the other source. ` +
          `Nothing to merge.`,
      );
    }

    // Snapshot the ancestor's current heads. Each reel's historyPoint
    // becomes its current max seq, so the merged history inherits the
    // full state at the ancestor as of right now. createBranch's
    // snapshotParentHeads uses atSeq as $lte on the seq filter; a
    // very large value catches every existing fact on the ancestor's
    // lineage.
    let result;
    try {
      result = await createBranch({
        parent: ancestor,
        anchor: { atSeq: Number.MAX_SAFE_INTEGER },
        label,
        createdBy: identity?.beingId || null,
      });
    } catch (err) {
      if (/invalid|required|not found/i.test(err.message)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `merge-histories: ${err.message}`,
        );
      }
      throw err;
    }

    // Stamp the merge provenance onto the new History row. mergeSources
    // is forensic; the canonical `parent` stays the common ancestor.
    await History.updateOne(
      { path: result.path },
      { $set: { mergeSources: [sourceA, sourceB] } },
    );
    invalidateHistoryCache(result.path);

    // Reset reels: state that's history-private by nature (today,
    // inhabit-state) is reset on the merged history so divergent
    // source states don't collide. Each reset stamps a fact with
    // params._merge for forensic audit.
    let resetCount = 0;
    let resetWarning = null;
    try {
      const actorBeingId = identity?.beingId;
      if (actorBeingId) {
        const resetFacts = await computeMergeResetFacts({
          mergedHistory: result.path,
          ancestor,
          actorBeingId,
        });
        for (const spec of resetFacts) {
          await emitFact(spec, moment);
        }
        resetCount = resetFacts.length;
      }
    } catch (err) {
      // Reset failures don't roll back the merged history (the history
      // and the resets are conceptually separate). Surface as part of
      // the response so the operator can investigate.
      resetWarning = err.message;
    }

    // afterAction: optionally pause or delete the source histories so
    // the front-end can wire "auto-tidy after merge" through one op
    // call. Failures here don't roll back the merged history . the
    // merge already succeeded; this is housekeeping. Failures surface
    // as a warning.
    const sourcesAffected = [];
    let afterWarning = null;
    if (afterAction !== "keep") {
      try {
        for (const historyPath of [sourceA, sourceB]) {
          if (afterAction === "pause") {
            await History.updateOne(
              { path: historyPath },
              {
                $set: {
                  paused: true,
                  pausedBy: identity?.beingId || null,
                  pausedAt: new Date(),
                  archivedBecause: `paused after merge into ${result.path}`,
                },
                $setOnInsert: {
                  _id: historyPath,
                  path: historyPath,
                  parent: historyPath === MAIN ? null : undefined,
                },
              },
              { upsert: true },
            );
          } else if (afterAction === "delete") {
            await History.updateOne(
              { path: historyPath },
              {
                $set: {
                  deleted: true,
                  deletedBy: identity?.beingId || null,
                  deletedAt: new Date(),
                  archivedBecause: `deleted after merge into ${result.path}`,
                },
                $setOnInsert: {
                  _id: historyPath,
                  path: historyPath,
                  parent: historyPath === MAIN ? null : undefined,
                },
              },
              { upsert: true },
            );
          }
          invalidateHistoryCache(historyPath);
          sourcesAffected.push(historyPath);
        }
      } catch (err) {
        afterWarning = err.message;
      }
    }

    // repointPointers: optional. Accepts a comma-separated list or
    // an array. Each named pointer gets repointed at the merged
    // history in a single set-being write to the @history-registry
    // being's qualities.pointers map.
    let pointersRepointed = [];
    let repointWarning = null;
    const repointArg = params?.repointPointers;
    let pointerNames = [];
    if (Array.isArray(repointArg)) {
      pointerNames = repointArg
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean);
    } else if (typeof repointArg === "string" && repointArg.trim().length > 0) {
      pointerNames = repointArg
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    if (pointerNames.length > 0) {
      for (const name of pointerNames) {
        if (!isPointerName(name)) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `merge-histories: repointPointers entry "${name}" is invalid. ` +
              `Pointer names must start with a lowercase letter, end with a letter or digit, ` +
              `contain only lowercase letters, digits, and single hyphens, ` +
              `and be at most ${POINTER_NAME_MAX_LENGTH} chars.`,
          );
        }
      }
      try {
        const current = await readPointers();
        const next = { ...current };
        for (const name of pointerNames) next[name] = result.path;
        const historiesSpaceId = await findPointersSpaceId();
        if (!historiesSpaceId) {
          repointWarning =
            ".histories heaven space not found; pointer updates skipped";
        } else {
          await doVerb(
            { kind: "space", id: historiesSpaceId },
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

    // Surface source-history pointers so the front-end can ask "this
    // history had #feature-x attached . want to move it to the merged
    // history, delete it, or leave it pointing at the now-historical
    // source?" Reverse lookup runs against the live pointer map.
    const [sourceAPointers, sourceBPointers] = await Promise.all([
      pointersFor(sourceA),
      pointersFor(sourceB),
    ]);

    // pauseResult: freeze the merged history immediately so operators
    // can resolve conflicts before its scheduler starts ticking and
    // the state drifts from whatever they decide. Unpause via
    // pause-history when ready. Failures here are non-fatal . the
    // merge succeeded; the freeze is housekeeping.
    let resultPaused = false;
    let pauseResultWarning = null;
    if (pauseResult) {
      try {
        await History.updateOne(
          { path: result.path },
          {
            $set: {
              paused: true,
              pausedBy: identity?.beingId || null,
              pausedAt: new Date(),
              archivedBecause: `paused for conflict resolution after merge of #${sourceA} + #${sourceB}`,
            },
          },
        );
        invalidateHistoryCache(result.path);
        resultPaused = true;
      } catch (err) {
        pauseResultWarning = err.message;
      }
    }

    const response = {
      merged: true,
      path: result.path,
      parent: result.parent,
      ancestor,
      mergeSources: [sourceA, sourceB],
      historyPoint: result.historyPoint,
      createdAt: result.createdAt,
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

// list-histories lived here briefly as a DO op. Retired 2026-06-02: the
// read-only graph belongs on a synthetic SEE catalog
// (`<story>/.histories[/<path>]`), not a DO op. DOs open transport-act
// moments that go through the scheduler and the orphan-act seal guard —
// neither of which a read-only query should be paying for. The catalog
// helper lives at seed/materials/history/historiesCatalog.js and is
// wired into seed/ibp/verbs/see.js.

// set-pointer / delete-pointer (named-pointer registry management) were
// carved out 2026-06-19 into the store bundle
// seed/store/words/history-pointers/ (index.js). The storage is still the
// `.histories` heaven space's qualities.pointers; the ops just live with
// their co-located `.word` slices now.
