// Execution-node management. The execution-node is the Foreman's
// emission surface at a Ruler scope: parallel to the plan-node
// (Planner's surface) and the contracts-node (Contractor's surface).
// It holds the Ruler scope's execution-records — one per dispatched
// run of an approved plan-emission, mutable while running and frozen
// to immutable archive on completion or supersession.
//
// The trio becomes a quartet: every Ruler scope materializes a
// plan-node, a contracts-node, and an execution-node. The Ruler
// holds three approval ledgers (planApprovals, contractApprovals,
// executionApprovals) tracking which emissions / records are
// currently in force.
//
// Phase A scope: lazy creation + role/mode stamping. Subsequent
// phases wire swarm to write step status updates onto
// execution-record nodes via the Foreman API.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Find or create the execution-type child of a Ruler scope. Idempotent:
 * returns the existing node if found, creates lazily otherwise.
 *
 * Stamps the execution-node with governing role "execution" so the
 * kernel's beforeNodeDelete guard refuses casual deletion (the
 * execution-record audit chain lives under here). Also assigns
 * tree:governing-foreman as the per-node plan-intent mode so visits
 * route to the Foreman mode once its reasoning surface lands.
 */
export async function ensureExecutionNode({ scopeNodeId, beingId, core }) {
  if (!scopeNodeId) return null;
  if (!core?.do) throw new Error("ensureExecutionNode requires `core` (verb surface)");

  // Idempotent probe.
  const existing = await Node.findOne({
    parent: scopeNodeId,
    type: "execution",
  }).select("_id name parent type metadata").lean();
  if (existing) return existing;

  // Phase 3b ([[project_seed_four_verbs_only]]): create lazily through
  // core.do("create-child"). The verb-surface call fires kernel hooks
  // and writes a Did automatically. Falls back to a direct insert only
  // when create-child fails for an operational reason (kept for
  // forward-compatibility; in practice should rarely trigger).
  //
  // Visible name is "runs" (parallel collection holding execution
  // records). The structural type stays "execution" because every
  // query in the codebase filters on type, not name. Renaming type
  // would be a destructive migration; renaming name is cosmetic and
  // reads more naturally to anyone walking the tree.
  let created = null;
  try {
    created = await core.do(scopeNodeId, "create-child", {
      name: "runs",
      type: "execution",
      beingId,
    });
  } catch (err) {
    log.debug("Governing", `core.do(create-child) failed for execution node: ${err.message}; falling back to direct insert`);
  }

  if (!created) {
    const { default: NodeModel } = await import("../../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name: "runs",
      type: "execution",
      parent: scopeNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne({ _id: scopeNodeId }, { $addToSet: { children: created._id } });
  }

  // Stamp role + mode through the verb surface. Each write auto-audits
  // as a Did. merge:true preserves siblings atomically (no read-spread-
  // write race window).
  try {
    const node = await Node.findById(created._id);
    if (node) {
      const existingMeta = node.metadata instanceof Map
        ? node.metadata.get(NS)
        : node.metadata?.[NS];
      const existingModes = node.metadata instanceof Map
        ? node.metadata.get("modes")
        : node.metadata?.modes;

      await core.do(node, "set-meta", {
        namespace: NS,
        data: {
          role: "execution",
          scopeRulerId: String(scopeNodeId),
          createdAt: existingMeta?.createdAt || new Date().toISOString(),
        },
        merge: true,
      });
      if (existingModes?.plan !== "tree:governing-foreman") {
        await core.do(node, "set-meta", {
          namespace: "modes",
          data: { plan: "tree:governing-foreman" },
          merge: true,
        });
      }

      // Declare the Foreman's home via the unified primitive. The
      // execution Node was just created; createBeingWithHome places the
      // Foreman being at it, generates a unique username + random
      // password, and writes metadata.beings.foreman.beingId. After
      // creation, merge governing's scopeRulerId alongside.
      const existingEmbodiments = node.metadata instanceof Map
        ? node.metadata.get("beings")
        : node.metadata?.embodiments;
      if (!existingEmbodiments?.foreman?.beingId) {
        const { createBeingWithHome } = await import("../../../seed/auth.js");
        await createBeingWithHome({
          operatingMode: "ai",
          role:          "foreman",
          homeNodeId:    String(created._id),
        });
        await core.do(node, "set-meta", {
          namespace: "beings",
          data: {
            foreman: {
              installedBy:  "governing",
              scopeRulerId: String(scopeNodeId),
            },
          },
          merge: true,
        });
        // Inner-being protection: only governing-role beings of THIS
        // rulership can SUMMON the Foreman. Scoped home check filters
        // other rulerships; role check filters humans / citizens.
        await core.do(node, "set-meta", {
          namespace: "permissions",
          data: {
            summon: {
              "@foreman*": {
                requires: {
                  role:         ["ruler", "planner", "contractor", "foreman"],
                  homeInDomain: String(scopeNodeId),
                },
              },
            },
          },
          merge: true,
        });
      }
    }
  } catch (err) {
    log.warn("Governing", `failed to stamp execution-node role/mode/beings: ${err.message}`);
  }

  return created;
}

/**
 * Find the execution-node child of a Ruler scope. Returns null when
 * absent (caller should call ensureExecutionNode first).
 */
export async function findExecutionNode(scopeNodeId) {
  if (!scopeNodeId) return null;
  return Node.findOne({
    parent: scopeNodeId,
    type: "execution",
  }).select("_id name parent type children metadata").lean();
}
