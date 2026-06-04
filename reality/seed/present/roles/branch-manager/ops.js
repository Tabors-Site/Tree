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
// Auth: any reigning being can mint a branch off any branch they can
// SEE. Promotion to live / pause / delete (Pass 6.5 + 10) require
// tighter permissions; for branch creation, the principle is "anyone
// who can read can fork" — branches are isolated worlds, the parent
// is unaffected.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { createBranch } from "../../../materials/branch/branchCreation.js";
import { MAIN, invalidateBranchCache } from "../../../materials/branch/branches.js";
import Branch from "../../../materials/branch/branch.js";

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
  },
  handler: async ({ params, identity }) => {
    const parent  = String(params?.parent || MAIN).trim() || MAIN;
    const label   = params?.label ? String(params.label).trim() : null;
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

    let result;
    try {
      result = await createBranch({
        parent,
        anchor,
        label,
        createdBy: identity?.beingId || null,
      });
    } catch (err) {
      // Path / lineage / arg errors surface as INVALID_INPUT; anything
      // else bubbles as INTERNAL.
      if (/invalid|required|not found/i.test(err.message)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, `create-branch: ${err.message}`);
      }
      throw err;
    }

    return {
      created:     true,
      path:        result.path,
      parent:      result.parent,
      anchor:      result.anchor,
      branchPoint: result.branchPoint,
      createdAt:   result.createdAt,
    };
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
  handler: async ({ params, identity, summonCtx }) => {
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

// list-branches lived here briefly as a DO op. Retired 2026-06-02: the
// read-only graph belongs on a synthetic SEE catalog
// (`<reality>/.branches[/<path>]`), not a DO op. DOs open transport-act
// moments that go through the scheduler and the orphan-act seal guard —
// neither of which a read-only query should be paying for. The catalog
// helper lives at seed/materials/branch/branchesCatalog.js and is
// wired into seed/ibp/verbs/see.js.
