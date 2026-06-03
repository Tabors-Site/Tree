// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner being. The place's LLM-configuration character.
//
// Scripted cognition. I am my code; the factory does not assemble
// a frame for me. When the operator summons me to configure which
// voices a being or a tree will speak in, my summon() executes
// deterministically and returns. The work I do is real — adding
// connections, assigning slots, planting tutorial matter — but
// it's code work, not inference. I have no presence lane and no
// frame on the reel beyond the Act row each call stamps.
//
// One canonical implementation, reached through `ibp:be
// <reality>/@llm-assigner` from every transport.
//
// Operations span three scopes:
//
//   self     add-llm, assign-slot, list-llms, delete-llm
//            Caller manages their own being's connections.
//
//   reality   set-reality-llm
//            Sets the reality-level default connectionId. Restricted
//            to the reality's root being — the first human
//            registered, identified structurally by parentBeingId:
//            null. There is no "admin" role anymore (isAdmin retired
//            2026-05-18); the root being is the operator by virtue
//            of having no being-tree parent.
//
//   space    set-space-llm
//            Sets qualities.llm.slots[slot] on a space the caller owns
//            (rootOwner matches). Drives the tree-level resolution
//            step in seed/present/cognition/llm/connect.js.
//
// Authorization gates here are coarse for now (self / root operator /
// tree ownership). The deferred stance-authorization framework will
// eventually express these rules uniformly; until then each method
// checks inline.

import log from "../../../seedReality/log.js";
import Being from "../../../materials/being/being.js";
import Space from "../../../materials/space/space.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { findRootOperator } from "../../../materials/being/identity.js";

// Tutorial-matter markers. The llm-assigner's start-tutorial /
// complete-tutorial BE ops use these to find and verify the intro
// matter the role plants on first contact. Lives here with the role
// spec rather than with the Being row in seedDelegates.js because the
// behavior these constants describe belongs to the role, not to the
// identity.
export const LLM_ASSIGNER_TUTORIAL_MARK = "llm-assigner-intro";
export const LLM_ASSIGNER_TUTORIAL_URL = "https://www.youtube.com/watch?v=_cXGZXdiVgw";
export const LLM_ASSIGNER_TUTORIAL_VIDEO_ID = "_cXGZXdiVgw";

export const llmAssignerBeing = Object.freeze({
  name: "llm-assigner",
  description: "Configures LLM connections — on the caller's being, on a space they own, or on the place itself (root operator only).",
  honoredOperations: [
    "add-llm",      // caller adds a connection to their own being
    "assign-slot",  // caller binds one of their connections to a slot
    "list-llms",    // caller lists their connections + slot assignments
    "delete-llm",   // caller removes one of their connections
    "set-reality-llm", // root operator sets the reality-level default
    "set-space-llm", // tree owner sets a slot on a specific space
  ],

  // ────────────────────────────────────────────────────────────────
  // Self-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Add an LLM connection to the caller's being. If this is the
   * being's first connection, it auto-binds to the "main" slot
   * (handled by the seed add-llm-connection DO op).
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

    const { addLlmConnection } = await import("../../cognition/llm/connect.js");
    const connection = await addLlmConnection(
      String(ctx.identity.beingId),
      { name, baseUrl, model, apiKey },
      { identity: ctx.identity, summonCtx: ctx.summonCtx },
    );
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
   * Being.qualities.beingLlm.slots.
   *
   * @param {object} payload  { slot, connectionId }   connectionId null to unbind
   */
  async assignSlot(payload, ctx) {
    requireAuthenticated(ctx);
    const { slot, connectionId } = payload || {};
    if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");

    // Dispatch through the seed DO op so the assign-llm-slot Fact
    // stamps and the stance-authorization gate runs uniformly. Same
    // path setSpaceLlm uses below for space targets.
    const beingId = String(ctx.identity.beingId);
    const { doVerb } = await import("../../../ibp/verbs/do.js");
    return doVerb(
      { kind: "being", id: beingId },
      "assign-llm-slot",
      { slot, connectionId: connectionId || null },
      { identity: ctx.identity, summonCtx: ctx.summonCtx },
    );
  },

  /**
   * List the caller's LLM connections + current slot assignments.
   *
   * @returns {object} { connections: [...], slots: { main, [...] } }
   */
  async listLlms(_payload, ctx) {
    requireAuthenticated(ctx);
    const beingId = String(ctx.identity.beingId);
    const { getBeingLlmAssignments } = await import("../../cognition/llm/connect.js");

    const { loadProjection } = await import("../../../materials/projections.js");
    const slot = await loadProjection("being", beingId, "0");
    const being = slot ? { _id: slot.id, ...slot.state } : null;
    const conns = (being?.qualities instanceof Map
      ? being.qualities.get("llmConnections")
      : being?.qualities?.llmConnections) || {};
    const connections = Object.entries(conns).map(([id, c]) => ({
      connectionId: id,
      name:         c.name,
      baseUrl:      c.baseUrl,
      model:        c.model,
      lastUsedAt:   c.lastUsedAt,
    }));
    return {
      connections,
      slots: getBeingLlmAssignments(being || {}),
    };
  },

  /**
   * Delete one of the caller's LLM connections. The seed cascades
   * the removal: clears Being.llmDefault, every Being.qualities.beingLlm
   * slot pointing at it, and every Space.qualities.llm.slots reference.
   *
   * @param {object} payload  { connectionId }
   */
  async deleteLlm(payload, ctx) {
    requireAuthenticated(ctx);
    const { connectionId } = payload || {};
    if (!connectionId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required");

    const { deleteLlmConnection } = await import("../../cognition/llm/connect.js");
    await deleteLlmConnection(
      String(ctx.identity.beingId),
      connectionId,
      { identity: ctx.identity, summonCtx: ctx.summonCtx },
    );
    return { removed: true, connectionId };
  },

  // ────────────────────────────────────────────────────────────────
  // Reality-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Set (or clear) the reality-level default LLM connection.
   * Restricted to the root operator (the first registered human;
   * identified by `parentBeingId: null`).
   *
   * @param {object} payload  { connectionId }  null to clear
   */
  async setRealityLlm(payload, ctx) {
    requireAuthenticated(ctx);
    await requireRootOperator(ctx);
    const { connectionId } = payload || {};
    if (connectionId === undefined) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required (pass null to clear)");
    }
    // Route through the verb so this being's identity gates the write
    // the same way reality-manager's set-config call does. realityLlmConnection
    // is not a protected key; no scaffold flag needed.
    const { SEED_SPACE } = await import("../../../materials/space/seedSpaces.js");
    const { doVerb } = await import("../../../ibp/verbs/do.js");
    const { findBySeedSpace } = await import("../../../materials/projections.js");
    const configNode = await findBySeedSpace(SEED_SPACE.CONFIG, "0");
    if (!configNode) {
      throw new IbpError(IBP_ERR.INTERNAL, "Reality .config seed space not found");
    }
    await doVerb(
      { kind: "space", id: String(configNode.id) },
      "set-config",
      { key: "realityLlmConnection", value: connectionId || null },
      { identity: ctx.identity, summonCtx: ctx.summonCtx },
    );
    return { realityLlmConnection: connectionId || null };
  },

  // ────────────────────────────────────────────────────────────────
  // Space-scope operations
  // ────────────────────────────────────────────────────────────────

  /**
   * Set an LLM slot on a space the caller owns (via rootOwner of the
   * containing tree). Writes qualities.llm.slots[slot] on the space —
   * the tree-level step of the resolution chain in
   * seed/present/cognition/llm/connect.js.
   *
   * @param {object} payload  { spaceId, slot, connectionId }
   *                          connectionId null to clear the slot
   */
  async setSpaceLlm(payload, ctx) {
    requireAuthenticated(ctx);
    const { spaceId, slot, connectionId } = payload || {};
    if (!spaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`spaceId` is required");
    if (!slot)   throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");

    const exists = await Space.exists({ _id: spaceId });
    if (!exists) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `Space ${spaceId} not found`);

    // Dispatch through the seed DO op so the stance-authorization
    // gate runs uniformly (same path the wire-side DO uses). The op's
    // handler routes space targets to assignSpaceConnection, which also
    // verifies the connection belongs to the caller before binding.
    const { doVerb } = await import("../../../ibp/verbs/do.js");
    const result = await doVerb(
      { kind: "space", id: String(spaceId) },
      "assign-llm-slot",
      { slot, connectionId: connectionId || null },
      { identity: ctx.identity, summonCtx: ctx.summonCtx },
    );

    log.verbose("llm-assigner",
      `space ${spaceId} slot "${slot}" → ${connectionId || "(cleared)"} by being ${ctx.identity.beingId}`);
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
      "This operation requires an authenticated being. Claim or register through @cherub first.",
    );
  }
}

async function requireRootOperator(ctx) {
  const operator = await findRootOperator();
  if (!operator) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "No root operator exists on this reality yet. Register the first human via @cherub.",
    );
  }
  if (String(operator._id) !== String(ctx.identity.beingId)) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Only the reality's root operator can change reality-level LLM configuration.",
    );
  }
}

// Stub role for the registry. llm-assigner is a delegate, not a
// summon-dispatched being: its real work happens through BE verb
// routing (llmAssignerBeing.add-llm / assign-slot / ... above). The
// role exists only so the @llm-assigner stance resolves and the being
// row can be planted with roles: ["llm-assigner"]; triggerOn: []
// means SUMMONs never queue, so assign never tries to dispatch
// through here.
export const llmAssignerRole = Object.freeze({
  name: "llm-assigner",
  description:
    "LLM-configuration delegate. Reached through BE verb (add-llm, assign-slot, set-space-llm, ...); not summon-dispatched.",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],
  async summon(_message, _ctx) {
    return null;
  },
});