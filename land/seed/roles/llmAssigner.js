// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner being.
//
// The land's LLM-configuration character. One canonical implementation,
// reached through `ibp:be <land>/@llm-assigner` from every transport.
//
// Operations span three scopes:
//
//   self     add-llm, assign-slot, list-llms, delete-llm
//            Caller manages their own being's connections.
//
//   land     set-land-llm
//            Sets the land-level default connectionId. Restricted to
//            the land's root being — the first human registered,
//            identified structurally by parentBeingId: null. There is
//            no "admin" role anymore (isAdmin retired 2026-05-18);
//            the root being is the land's operator by virtue of
//            having no being-tree parent.
//
//   node     set-node-llm
//            Sets metadata.llm.slots[slot] on a node the caller owns
//            (rootOwner matches). Drives the tree-level resolution
//            step in seed/llm/llmClient.js.
//
// Authorization gates here are coarse for now (self / root operator /
// tree ownership). The deferred stance-authorization framework
// ([[project_stance_authorization]]) will eventually express these
// rules uniformly; until then each method checks inline.

import log from "../core/log.js";
import Being from "../models/being.js";
import Node from "../models/node.js";
import { IbpError, IBP_ERR } from "../core/errors.js";
import { findRootBeing } from "../core/systemBeings.js";
import { setLandConfigValue } from "../landConfig.js";

export const llmAssignerBeing = Object.freeze({
  name: "llm-assigner",
  description: "Configures LLM connections — on the caller's being, on a node they own, or on the land itself (root operator only).",
  honoredOperations: [
    "add-llm",       // caller adds a connection to their own being
    "assign-slot",   // caller binds one of their connections to a slot
    "list-llms",     // caller lists their connections + slot assignments
    "delete-llm",    // caller removes one of their connections
    "set-land-llm",  // root operator sets the land-level default
    "set-node-llm",  // tree owner sets a slot on a specific node
  ],

  // ────────────────────────────────────────────────────────────────
  // Self-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Add an LLM connection to the caller's being. If this is the
   * being's first connection, it auto-binds to the "main" slot
   * (handled by the kernel add-llm-connection DO op).
   *
   * @param {object} payload  { name?, baseUrl, model, apiKey }
   * @returns {object}        { connectionId, name, baseUrl, model }
   */
  async addLlm(payload, ctx) {
    requireAuthenticated(ctx);
    const { name = null, baseUrl, model, apiKey = null } = payload || {};
    if (!baseUrl) throw new IbpError(IBP_ERR.INVALID_INPUT, "`baseUrl` is required");
    if (!model)   throw new IbpError(IBP_ERR.INVALID_INPUT, "`model` is required");
    // apiKey is optional — local LLMs (Ollama, llama.cpp) don't need it.

    const { addLlmConnection } = await import("../llm/connections.js");
    const connection = await addLlmConnection(String(ctx.identity.beingId), { name, baseUrl, model, apiKey });
    return {
      connectionId: String(connection._id),
      name:         connection.name,
      baseUrl:      connection.baseUrl,
      model:        connection.model,
    };
  },

  /**
   * Bind one of the caller's connections to a slot on their own being.
   * Slot "main" updates Being.llmDefault; named slots write into
   * Being.metadata.userLlm.slots.
   *
   * @param {object} payload  { slot, connectionId }   connectionId null to unbind
   */
  async assignSlot(payload, ctx) {
    requireAuthenticated(ctx);
    const { slot, connectionId } = payload || {};
    if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");

    const { assignConnection } = await import("../llm/connections.js");
    return assignConnection(String(ctx.identity.beingId), slot, connectionId || null);
  },

  /**
   * List the caller's LLM connections + current slot assignments.
   *
   * @returns {object} { connections: [...], slots: { main, [...] } }
   */
  async listLlms(_payload, ctx) {
    requireAuthenticated(ctx);
    const beingId = String(ctx.identity.beingId);
    const LlmConnection = (await import("../models/llmConnection.js")).default;
    const { getBeingLlmAssignments } = await import("../llm/assignments.js");

    const [connections, being] = await Promise.all([
      LlmConnection.find({ beingId }).select("_id name baseUrl model lastUsedAt").lean(),
      Being.findById(beingId).select("llmDefault metadata").lean(),
    ]);
    return {
      connections: connections.map(c => ({
        connectionId: String(c._id),
        name:         c.name,
        baseUrl:      c.baseUrl,
        model:        c.model,
        lastUsedAt:   c.lastUsedAt,
      })),
      slots: getBeingLlmAssignments(being || {}),
    };
  },

  /**
   * Delete one of the caller's LLM connections. The kernel cascades
   * the removal: clears Being.llmDefault, every Being.metadata.userLlm
   * slot pointing at it, and every Node.metadata.llm.slots reference.
   *
   * @param {object} payload  { connectionId }
   */
  async deleteLlm(payload, ctx) {
    requireAuthenticated(ctx);
    const { connectionId } = payload || {};
    if (!connectionId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required");

    const { deleteLlmConnection } = await import("../llm/connections.js");
    await deleteLlmConnection(String(ctx.identity.beingId), connectionId);
    return { removed: true, connectionId };
  },

  // ────────────────────────────────────────────────────────────────
  // Land-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Set (or clear) the land-level default LLM connection. Restricted
   * to the root operator (the first registered human; identified by
   * `parentBeingId: null`).
   *
   * @param {object} payload  { connectionId }  null to clear
   */
  async setLandLlm(payload, ctx) {
    requireAuthenticated(ctx);
    await requireRootOperator(ctx);
    const { connectionId } = payload || {};
    if (connectionId === undefined) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required (pass null to clear)");
    }
    await setLandConfigValue("landLlmConnection", connectionId || null, { internal: true });
    return { landLlmConnection: connectionId || null };
  },

  // ────────────────────────────────────────────────────────────────
  // Node-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Set an LLM slot on a node the caller owns (via rootOwner of the
   * containing tree). Writes metadata.llm.slots[slot] on the node —
   * the tree-level step of the resolution chain in
   * seed/llm/llmClient.js.
   *
   * @param {object} payload  { nodeId, slot, connectionId }
   *                          connectionId null to clear the slot
   */
  async setNodeLlm(payload, ctx) {
    requireAuthenticated(ctx);
    const { nodeId, slot, connectionId } = payload || {};
    if (!nodeId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`nodeId` is required");
    if (!slot)   throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");

    const node = await Node.findById(nodeId);
    if (!node) throw new IbpError(IBP_ERR.NODE_NOT_FOUND, `Node ${nodeId} not found`);

    // Dispatch through the kernel DO op so the stance-authorization
    // gate runs uniformly (same path the wire-side DO uses). The op's
    // handler routes node targets to assignNodeConnection, which also
    // verifies the connection belongs to the caller before binding.
    const { doVerb } = await import("../core/verbs.js");
    const result = await doVerb(node, "assign-llm-slot", { slot, connectionId: connectionId || null }, {
      identity: ctx.identity,
    });

    log.verbose("llm-assigner",
      `node ${nodeId} slot "${slot}" → ${connectionId || "(cleared)"} by being ${ctx.identity.beingId}`);
    return result;
  },
});

// ────────────────────────────────────────────────────────────────────
// Guards
// ────────────────────────────────────────────────────────────────────

function requireAuthenticated(ctx) {
  if (!ctx?.identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "This operation requires an authenticated being. Claim or register through @auth first.",
    );
  }
}

async function requireRootOperator(ctx) {
  const root = await findRootBeing();
  if (!root) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "No root being exists on this land yet. Register the first human via @auth.",
    );
  }
  if (String(root._id) !== String(ctx.identity.beingId)) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Only the land's root operator can change land-level LLM configuration.",
    );
  }
}
