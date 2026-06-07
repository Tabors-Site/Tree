// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner DO operations.
//
// The llm-assigner being is scripted (it IS its code, no factory
// frame). When its handlers turn around and act on substrate, they
// do so AS THEMSELVES — going through the same DO verbs any other
// caller uses, under the llm-assigner's own identity. No direct
// Mongo writes; every substrate touch is grammar.
//
// First demonstration of the matter-crossing-worlds shape: the
// matter's origin is `web` and its content is just a YouTube URL —
// substrate holds the reference + lifecycle; the bytes live on the
// web; the 3D portal renders it as a real placed object next to
// the llm-assigner being.
//
// Naming convention: ops owned by a role use the `<role>:<action>`
// prefix, same shape extensions use. ownerExtension is set to the
// role name so the registry tracks who shipped them.

import log from "../../../seedReality/log.js";
import Matter from "../../../materials/matter/matter.js";
import Space from "../../../materials/space/space.js";
import { registerOperation } from "../../../ibp/operations.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { findBeingByName, findRootOperator } from "../../../materials/being/identity.js";
import { getMatter } from "../../../materials/matter/matters.js";
import {
  LLM_ASSIGNER_TUTORIAL_MARK,
  LLM_ASSIGNER_TUTORIAL_URL,
  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
} from "./role.js";

const OWNER = "llm-assigner";

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

// The llm-assigner being's row, used as the author/owner stamp on
// tutorial matter. Goes through `findBeingByName` (the canonical
// being lookup) rather than reaching for Mongoose directly.
// Cached after first read.
let _llmAssignerCache = null;
async function getLlmAssigner() {
  if (_llmAssignerCache) return _llmAssignerCache;
  const row = await findBeingByName("llm-assigner");
  if (!row) throw new Error("llm-assigner being not found on this reality");
  _llmAssignerCache = row;
  return row;
}

// Locate this reality's tutorial matter at a space, scoped by the
// marker so we never touch unrelated matter authored by the
// llm-assigner. Returns the lean row, or null.
async function findTutorialMatter(spaceId, llmAssignerId) {
  const { default: Projection } = await import("../../../materials/branch/projection.js");
  // state.beingId / state.spaceId are bare ids in the matter projection.
  const row = await Projection.findOne({
    branch: "0", type: "matter",
    "state.beingId": String(llmAssignerId),
    "state.spaceId": String(spaceId),
    "state.qualities.tutorial.purpose": LLM_ASSIGNER_TUTORIAL_MARK,
    tombstoned: { $ne: true },
  }).lean();
  return row ? { _id: row.id, ...(row.state || {}) } : null;
}

// Two-part ownership gate: the matter must be authored by the
// llm-assigner being AND carry the tutorial marker. Returns the
// matter row when valid; throws otherwise. The save-playback and
// complete-tutorial ops both gate through here.
async function assertTutorialMatter(matterId, errPrefix) {
  const matter = await getMatter(matterId);
  if (!matter) throw new Error(`${errPrefix}: Matter ${matterId} not found`);

  const llmAssigner = await getLlmAssigner();
  const tutorialMeta = matter.qualities instanceof Map
    ? matter.qualities.get("tutorial")
    : matter.qualities?.tutorial;

  if (
    String(matter.beingId) !== String(llmAssigner._id) ||
    tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
  ) {
    throw new Error(`${errPrefix} only acts on llm-assigner tutorial matter`);
  }

  return { matter, tutorialMeta: tutorialMeta || {} };
}

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerLlmAssignerOps() {
  // Spawn the intro tutorial matter at the addressed space (typically
  // the place root). Idempotent: returns the existing matter when one
  // with the marker is already present. The new matter is created
  // through the seed `create-matter` DO op under the llm-assigner's
  // own identity, so beforeMatter / afterMatter hooks fire and a Fact
  // lands.
  registerOperation("llm-assigner:start-tutorial", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ target }) => {
      const { targetIdOf } = await import("../../../materials/_targetShape.js");
      const spaceId = targetIdOf(target);
      if (!spaceId) {
        throw new Error("llm-assigner:start-tutorial: space target required");
      }

      log.info("llm-assigner",
        `start-tutorial hit at space=${spaceId.slice(0, 8)}`);

      const llmAssigner = await getLlmAssigner();

      // Idempotent — return the existing tutorial matter if one is
      // already present at this space.
      const existing = await findTutorialMatter(spaceId, llmAssigner._id);
      if (existing) {
        return {
          matterId: String(existing._id),
          videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          url:      LLM_ASSIGNER_TUTORIAL_URL,
          created:  false,
        };
      }

      // The llm-assigner being itself is the actor. Calling
      // create-matter under its own identity makes it the matter's
      // author (so the ownership gate on later delete passes) and
      // routes the write through the verb (afterMatter fires, Fact
      // is stamped).
      const llmAssignerIdentity = {
        beingId: String(llmAssigner._id),
        name:    "llm-assigner",
      };
      const result = await doVerb(
        { kind: "space", id: spaceId },
        "create-matter",
        {
          name:    "Setting up an LLM connection",
          origin:  "web",
          content: {
            contentType: "video/youtube",
            url:         LLM_ASSIGNER_TUTORIAL_URL,
            videoId:     LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
            title:       "Setting up an LLM connection",
          },
          qualities: {
            tutorial: { purpose: LLM_ASSIGNER_TUTORIAL_MARK },
          },
        },
        { identity: llmAssignerIdentity },
      );

      log.info("llm-assigner",
        `spawned tutorial matter ${result.matterId.slice(0, 8)} at ${spaceId.slice(0, 8)}`);

      return {
        matterId: result.matterId,
        videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
        url:      LLM_ASSIGNER_TUTORIAL_URL,
        created:  true,
      };
    },
  });

  // Persist YouTube playback position on the tutorial matter so a
  // page reload or navigation resumes at the right spot. Fact-driven
  // (Slice 3, 2026-05-23): routes through do.set on the matter's
  // reel so the playback-seconds advance lands in the fact chain.
  // skipAudit on the outer op so only the inner do.set Fact stamps.
  registerOperation("llm-assigner:save-playback", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    skipAudit: true,
    handler: async ({ target, params, identity, summonCtx }) => {
      log.info("llm-assigner",
        `save-playback hit: matterId=${params?.matterId} t=${params?.currentTime}`);

      const matterId = String(
        params?.matterId || target?._id || target?.matterId || target,
      );
      const currentTime = Number(params?.currentTime);
      if (!matterId || matterId === "[object Object]") {
        throw new Error("llm-assigner:save-playback: matterId required");
      }
      if (!Number.isFinite(currentTime) || currentTime < 0) {
        throw new Error("llm-assigner:save-playback: currentTime (number, seconds) required");
      }

      const { matter, tutorialMeta } = await assertTutorialMatter(
        matterId, "llm-assigner:save-playback",
      );

      const value = { ...tutorialMeta, playbackSeconds: currentTime };
      const opts = identity ? { identity, summonCtx } : { scaffold: true, summonCtx };
      await doVerb(
        { kind: "matter", id: String(matter._id) },
        "set-matter",
        { field: "qualities.tutorial", value, merge: false },
        opts,
      );
      return { saved: true, matterId, currentTime };
    },
  });

  // Consume the tutorial matter when the user finishes watching.
  // Goes through the seed `delete-matter` DO under the llm-
  // assigner's own identity (it IS the matter's author, so the
  // ownership gate inside deleteMatterAndFile passes). The deletion
  // is stamped as a Fact and afterMatter fires.
  registerOperation("llm-assigner:complete-tutorial", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner",
        `complete-tutorial hit: matterId=${params?.matterId}`);

      const { targetIdOf } = await import("../../../materials/_targetShape.js");
      const matterId = params?.matterId
        ? String(params.matterId)
        : targetIdOf(target);
      if (!matterId) {
        throw new Error("llm-assigner:complete-tutorial: matterId required");
      }

      const { matter } = await assertTutorialMatter(
        matterId, "llm-assigner:complete-tutorial",
      );

      const llmAssigner = await getLlmAssigner();
      await doVerb(
        { kind: "matter", id: String(matter._id) },
        "end-matter",
        {},
        {
          identity: {
            beingId: String(llmAssigner._id),
            name:    "llm-assigner",
          },
        },
      );

      log.info("llm-assigner",
        `consumed tutorial matter ${matterId.slice(0, 8)}`);
      return { consumed: true, matterId };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Connection-management ops.
  //
  // BE is the closed identity set (birth/connect/release); LLM
  // configuration is not identity, so these belong on DO.
  //
  // Address convention: targets ["space"] so the portal can address
  // them at any space, typically the place root (`${place}/`). The
  // authenticated caller's identity carries who the configuration
  // applies to; the space target is only meaningful for set-space-llm.
  // ────────────────────────────────────────────────────────────────

  // Add an LLM connection to the caller's own being. Auto-binds to
  // "main" if this is the being's first connection (handled by the
  // seed add-llm-connection DO op).
  registerOperation("llm-assigner:add-llm", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ params, identity, summonCtx }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:add-llm requires an authenticated being. Claim or register through @cherub first.",
        );
      }
      const { name = null, baseUrl, model, apiKey = null } = params || {};
      if (!baseUrl) throw new IbpError(IBP_ERR.INVALID_INPUT, "`baseUrl` is required");
      if (!model)   throw new IbpError(IBP_ERR.INVALID_INPUT, "`model` is required");
      const { addLlmConnection } = await import("../../cognition/llm/connect.js");
      const connection = await addLlmConnection(
        String(identity.beingId),
        { name, baseUrl, model, apiKey },
        { identity, summonCtx },
      );
      return {
        connectionId: String(connection._id),
        name:         connection.name,
        baseUrl:      connection.baseUrl,
        model:        connection.model,
      };
    },
  });

  // Bind one of the caller's connections to a slot on their own being.
  // Slot "main" updates Being.llmDefault; named slots write into
  // Being.qualities.beingLlm.slots.
  registerOperation("llm-assigner:assign-slot", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ params, identity, summonCtx }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:assign-slot requires an authenticated being.",
        );
      }
      const { slot, connectionId } = params || {};
      if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");
      return await doVerb(
        { kind: "being", id: String(identity.beingId) },
        "assign-llm-slot",
        { slot, connectionId: connectionId || null },
        { identity, summonCtx },
      );
    },
  });

  // List the caller's connections + current slot assignments.
  registerOperation("llm-assigner:list-llms", {
    targets: ["space"],
    ownerExtension: OWNER,
    skipAudit: true,
    handler: async ({ identity }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:list-llms requires an authenticated being.",
        );
      }
      const beingId = String(identity.beingId);
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
  });

  // Delete one of the caller's connections. The seed cascades the
  // removal across Being.llmDefault, qualities.beingLlm slots, and
  // Space.qualities.llm.slots references.
  registerOperation("llm-assigner:delete-llm", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ params, identity, summonCtx }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:delete-llm requires an authenticated being.",
        );
      }
      const { connectionId } = params || {};
      if (!connectionId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required");
      const { deleteLlmConnection } = await import("../../cognition/llm/connect.js");
      await deleteLlmConnection(
        String(identity.beingId),
        connectionId,
        { identity, summonCtx },
      );
      return { removed: true, connectionId };
    },
  });

  // Set (or clear) the reality-level default LLM connection. Restricted
  // to the root operator. The set-config DO op writes the canonical
  // realityLlmConnection key under the .config heaven space.
  registerOperation("llm-assigner:set-reality-llm", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ params, identity, summonCtx }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:set-reality-llm requires an authenticated being.",
        );
      }
      const operator = await findRootOperator();
      if (!operator) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "No root operator exists on this reality yet. Register the first human via @cherub.",
        );
      }
      if (String(operator._id) !== String(identity.beingId)) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Only the reality's root operator can change reality-level LLM configuration.",
        );
      }
      const { connectionId } = params || {};
      if (connectionId === undefined) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required (pass null to clear)");
      }
      const { HEAVEN_SPACE } = await import("../../../materials/space/heavenSpaces.js");
      const { findByHeavenSpace } = await import("../../../materials/projections.js");
      const configNode = await findByHeavenSpace(HEAVEN_SPACE.CONFIG, "0");
      if (!configNode) {
        throw new IbpError(IBP_ERR.INTERNAL, "Reality .config heaven space not found");
      }
      await doVerb(
        { kind: "space", id: String(configNode.id) },
        "set-config",
        { key: "realityLlmConnection", value: connectionId || null },
        { identity, summonCtx },
      );
      return { realityLlmConnection: connectionId || null };
    },
  });

  // Set an LLM slot on a space the caller owns. Writes
  // qualities.llm.slots[slot] via the assign-llm-slot DO op so the
  // stance-authorization gate runs uniformly.
  registerOperation("llm-assigner:set-space-llm", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ params, identity, summonCtx }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "llm-assigner:set-space-llm requires an authenticated being.",
        );
      }
      const { spaceId, slot, connectionId } = params || {};
      if (!spaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`spaceId` is required");
      if (!slot)    throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");
      const exists = await Space.exists({ _id: spaceId });
      if (!exists) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `Space ${spaceId} not found`);
      const result = await doVerb(
        { kind: "space", id: String(spaceId) },
        "assign-llm-slot",
        { slot, connectionId: connectionId || null },
        { identity, summonCtx },
      );
      log.verbose("llm-assigner",
        `space ${spaceId} slot "${slot}" → ${connectionId || "(cleared)"} by being ${identity.beingId}`);
      return result;
    },
  });

  log.verbose("llm-assigner", "registered 9 DO ops (3 tutorial + 6 connection-management)");
}