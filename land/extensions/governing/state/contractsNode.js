// Contracts trio member management. The contracts node is the
// Contractor's emission surface at a Ruler scope — symmetric with the
// plan node (Planner's surface) and the execution node (Foreman's
// surface). Each Contractor invocation creates a `contracts-emission-N`
// child node under this node carrying the structured contract set;
// the Ruler scope holds metadata.governing.contractApprovals as the
// approval ledger pointing at the active emission.
//
// This file owns the trio-member node primitive (find/create with
// role + mode stamping). The ring-record machinery — emission
// creation, approval ledger, idempotency, readActive, readContracts —
// lives in contracts.js.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Find or create the contracts-type child of a Ruler scope. Idempotent:
 * returns the existing node if found, creates lazily otherwise.
 *
 * Scope MUST be the Ruler scope (the parent of the trio, not the trio
 * member itself). Caller is responsible for ensuring scopeNodeId is a
 * Ruler — typically governing.findRulerScope or runRulerCycle's
 * currentNodeId after promotion.
 */
export async function ensureContractsNode({ scopeNodeId, beingId, core }) {
  if (!scopeNodeId) return null;
  if (!core?.do) throw new Error("ensureContractsNode requires `core` (verb surface)");

  // Direct probe for an existing contracts-type child.
  const existing = await Node.findOne({
    parent: scopeNodeId,
    type: "contracts",
  }).select("_id name parent type metadata").lean();
  if (existing) return existing;

  // Phase 3b ([[project_seed_four_verbs_only]]): create lazily through
  // core.do("create-child"). Fires kernel hooks + auto-writes a Did.
  // Falls back to direct insert only on operational failure.
  let created = null;
  try {
    created = await core.do(scopeNodeId, "create-child", {
      name: "contracts",
      type: "contracts",
      beingId,
    });
  } catch (err) {
    log.debug("Governing", `core.do(create-child) failed for contracts node: ${err.message}; falling back to direct insert`);
  }

  if (!created) {
    const { default: NodeModel } = await import("../../../seed/models/node.js");
    const { v4: uuid } = await import("uuid");
    created = await NodeModel.create({
      _id: uuid(),
      name: "contracts",
      type: "contracts",
      parent: scopeNodeId,
      children: [],
      contributors: [],
      status: "active",
    });
    await NodeModel.updateOne({ _id: scopeNodeId }, { $addToSet: { children: created._id } });
  }

  // Mark the contracts node as structural for governing. The kernel's
  // beforeNodeDelete guard refuses deletion of any node carrying an
  // extension role marker — without this, a casual cd-and-delete would
  // wipe the audit chain. See CLAUDE.md "role field marks structural
  // nodes."
  //
  // Also assign the per-node Contractor mode so anyone visiting the
  // contracts node chats with Contractor by default. All metadata
  // writes flow through core.do for auto-Did + atomic merge.
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
          role: "contracts",
          scopeRulerId: String(scopeNodeId),
          createdAt: existingMeta?.createdAt || new Date().toISOString(),
        },
        merge: true,
      });
      if (existingModes?.plan !== "tree:governing-contractor") {
        await core.do(node, "set-meta", {
          namespace: "modes",
          data: { plan: "tree:governing-contractor" },
          merge: true,
        });
      }

      // Declare the Contractor's home via the unified primitive. The
      // contracts trio Node was just created; createBeingWithHome places
      // the Contractor being at it, generates a unique username + random
      // password, and writes metadata.beings.contractor.beingId.
      // After creation, merge governing's scopeRulerId alongside.
      const existingEmbodiments = node.metadata instanceof Map
        ? node.metadata.get("beings")
        : node.metadata?.embodiments;
      if (!existingEmbodiments?.contractor?.beingId) {
        const { createBeingWithHome } = await import("../../../seed/auth.js");
        await createBeingWithHome({
          operatingMode: "ai",
          role:          "contractor",
          homeNodeId:    String(created._id),
        });
        await core.do(node, "set-meta", {
          namespace: "beings",
          data: {
            contractor: {
              installedBy:  "governing",
              scopeRulerId: String(scopeNodeId),
            },
          },
          merge: true,
        });
        // Inner-being protection: only governing-role beings of THIS
        // rulership can SUMMON the Contractor. The scoped
        // `homeInDomain` keeps other rulerships' beings out; the role
        // list keeps humans / citizens out.
        await core.do(node, "set-meta", {
          namespace: "permissions",
          data: {
            summon: {
              "@contractor*": {
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
    log.warn("Governing", `failed to stamp contracts-node role/mode/beings: ${err.message}`);
  }

  return created;
}

// readContractsMap, readApprovalLedger, parseContractRef,
// buildContractRef removed in the contracts ring refactor. Each
// Contractor invocation now creates a contracts-emission-N child node
// (same shape as plan-emission-N and execution-record-N); the
// approval ledger uses single-emission entries with `contractsRef:
// <emissionNodeId>`. Read paths live in contracts.js as
// readActiveContractsEmission + readContracts + readScopedContracts.
