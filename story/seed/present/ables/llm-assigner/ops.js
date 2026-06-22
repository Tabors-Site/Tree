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
// Naming convention: ops owned by a able use the `<able>:<action>`
// prefix, same shape extensions use. ownerExtension is set to the
// able name so the registry tracks who shipped them.

import log from "../../../seedStory/log.js";
import Space from "../../../materials/space/space.js";
import { registerOperation } from "../../../ibp/operations.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { findBeingByName } from "../../../materials/being/identity.js";

const OWNER = "llm-assigner";

// ────────────────────────────────────────────────────────────────────
// 7-step chain helpers (auth.jpg)
// ────────────────────────────────────────────────────────────────────
//
// The new ops accept `{slot, connections, forceActor, forceReceiver,
// preferOwn}` in addition to the legacy `{slot, connectionId}` shape.
// `connections` may be a string or string[] — both normalize to an
// ordered list under `qualities.llm.slots[slot]` (per able) or
// `qualities.llm.default` (when slot is "main" or absent).
//
// Mutual exclusion on the force flags is enforced here: any op write
// that asserts both `forceActor=true` and `forceReceiver=true` is
// rejected with `INVALID_INPUT`. Setting one true automatically clears
// the other on the same container.

const VALID_SLOT_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function normalizeConnectionList(raw) {
  if (raw === null || raw === undefined) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string" || !item.length || item.length > 100) continue;
    out.push(item);
  }
  return out;
}

function assertFlagMutex(params) {
  if (params.forceActor === true && params.forceReceiver === true) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "forceActor and forceReceiver cannot both be true on the same container. " +
      "Pick one — the chain caps at this container (forceReceiver) or jumps to the actor side (forceActor).",
    );
  }
}

// Write the 7-step chain fields onto a container (being or space) by
// dispatching set-being / set-space DOs through doVerb. Each field
// write is its own DO call so the one-moment-one-act doctrine holds.
// Returns a summary of what was written.
async function writeLlmFields(targetKind, targetId, params, identity, moment) {
  const verb = targetKind === "being" ? "set-being" : "set-space";
  const written = {};

  // Slot list write — qualities.llm.slots[slot] or qualities.llm.default.
  const slot = params.slot || null;
  const connections = normalizeConnectionList(params.connections);
  if (slot && connections !== null) {
    if (!VALID_SLOT_RE.test(slot)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `invalid slot name "${slot}"`);
    }
    const field = slot === "main" || slot === "default"
      ? "qualities.llm.default"
      : `qualities.llm.slots.${slot}`;
    await doVerb(
      { kind: targetKind, id: String(targetId) },
      verb,
      { field, value: connections, merge: false },
      { identity, moment },
    );
    written[field] = connections;
  }

  // Mutex on force flags. If one flag is being set true, clear the
  // other implicitly so the container is always in a valid posture.
  const flagWrites = [];
  if (params.forceReceiver === true) {
    flagWrites.push(["qualities.llm.forceReceiver", true]);
    flagWrites.push(["qualities.llm.forceActor", false]);
  } else if (params.forceActor === true) {
    flagWrites.push(["qualities.llm.forceActor", true]);
    flagWrites.push(["qualities.llm.forceReceiver", false]);
  } else if (params.forceActor === false) {
    flagWrites.push(["qualities.llm.forceActor", false]);
  } else if (params.forceReceiver === false) {
    flagWrites.push(["qualities.llm.forceReceiver", false]);
  }
  if (typeof params.preferOwn === "boolean") {
    flagWrites.push(["qualities.llm.preferOwn", params.preferOwn]);
  }
  for (const [field, value] of flagWrites) {
    await doVerb(
      { kind: targetKind, id: String(targetId) },
      verb,
      { field, value, merge: false },
      { identity, moment },
    );
    written[field] = value;
  }

  return written;
}


// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerLlmAssignerOps() {
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
  registerOperation("add-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "add-llm requires an authenticated being. Claim or register through @cherub first.",
        );
      }
      const { name = null, baseUrl, model, apiKey = null } = params || {};
      if (!baseUrl) throw new IbpError(IBP_ERR.INVALID_INPUT, "`baseUrl` is required");
      if (!model)   throw new IbpError(IBP_ERR.INVALID_INPUT, "`model` is required");
      const { addLlmConnection } = await import("../../cognition/llm/connect.js");
      const connection = await addLlmConnection(
        String(identity.beingId),
        { name, baseUrl, model, apiKey },
        { identity, moment },
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
  // All slots (including "main") write into Being.qualities.beingLlm.slots.
  registerOperation("assign-slot", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "assign-slot requires an authenticated being.",
        );
      }
      const { slot, connectionId } = params || {};
      if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "`slot` is required");
      return await doVerb(
        { kind: "being", id: String(identity.beingId) },
        "assign-llm-slot",
        { slot, connectionId: connectionId || null },
        { identity, moment },
      );
    },
  });

  // List the caller's connections + current slot assignments.
  // list-llms retired as a DO op. The caller's connections are a
  // read-only perception → registered below as `llm-connections` SEE
  // op (see registerSeeOperation block at the bottom of this file).

  // Delete one of the caller's connections. The seed cascades the
  // removal across qualities.beingLlm slots and qualities.llm.slots
  // references.
  registerOperation("delete-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "delete-llm requires an authenticated being.",
        );
      }
      const { connectionId } = params || {};
      if (!connectionId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`connectionId` is required");
      const { deleteLlmConnection } = await import("../../cognition/llm/connect.js");
      await deleteLlmConnection(
        String(identity.beingId),
        connectionId,
        { identity, moment },
      );
      return { removed: true, connectionId };
    },
  });

  // Set the story-level LLM configuration on the place root's
  // `qualities.llm`. Writes the 7-step chain fields (slot list, force
  // flags, preferOwn). Restricted to beings with heaven authority
  // (owner or angel able on heaven).
  //
  // Back-compat: when `connectionId` (legacy scalar) is the only
  // payload field, it is converted to a single-element `connections`
  // list under `qualities.llm.default` (so existing UIs keep working).
  registerOperation("set-story-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "set-story-llm requires an authenticated being.",
        );
      }
      const { hasHeavenAuthority } = await import("../../../materials/space/heavenLineage.js");
      if (!(await hasHeavenAuthority(identity.beingId))) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Only beings with heaven authority (owner or angel able) can change story-level LLM configuration.",
        );
      }
      assertFlagMutex(params || {});
      const { findRoot } = await import("../../../materials/projections.js");
      const roots = await findRoot("space", "0");
      const rootRow = roots && roots[0] ? roots[0] : null;
      if (!rootRow) {
        throw new IbpError(IBP_ERR.INTERNAL, "Story place root not found");
      }
      // Legacy scalar → list conversion. If the caller passed only
      // `connectionId` (the pre-rewire shape), map it onto `connections`
      // under the default slot.
      const normalized = { ...(params || {}) };
      if (normalized.connections === undefined && normalized.connectionId !== undefined) {
        normalized.connections = normalized.connectionId === null ? [] : [normalized.connectionId];
        normalized.slot = normalized.slot || "default";
        delete normalized.connectionId;
      }
      const written = await writeLlmFields("space", rootRow.id, normalized, identity, moment);
      log.verbose("llm-assigner",
        `story root LLM updated by ${identity.beingId}: ${Object.keys(written).join(", ") || "(no fields)"}`);
      return { spaceId: String(rootRow.id), written };
    },
  });

  // Set an LLM configuration on a space the caller owns. Writes the
  // 7-step chain fields (slot list, force flags, preferOwn) to
  // `<space>.qualities.llm`. Back-compat: legacy `{slot, connectionId}`
  // payload is mapped to `{slot, connections: [connectionId]}`.
  registerOperation("set-space-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "set-space-llm requires an authenticated being.",
        );
      }
      const { spaceId } = params || {};
      if (!spaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "`spaceId` is required");
      const exists = await Space.exists({ _id: spaceId });
      if (!exists) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, `Space ${spaceId} not found`);
      assertFlagMutex(params);
      // Legacy scalar → list conversion.
      const normalized = { ...params };
      if (normalized.connections === undefined && normalized.connectionId !== undefined) {
        normalized.connections = normalized.connectionId === null ? [] : [normalized.connectionId];
        normalized.slot = normalized.slot || "default";
        delete normalized.connectionId;
      }
      const written = await writeLlmFields("space", spaceId, normalized, identity, moment);
      log.verbose("llm-assigner",
        `space ${spaceId} LLM updated by ${identity.beingId}: ${Object.keys(written).join(", ") || "(no fields)"}`);
      return { spaceId: String(spaceId), written };
    },
  });

  // Set the calling being's own LLM configuration. Writes the 7-step
  // chain fields to `<being>.qualities.llm`. The caller can configure
  // per-able slots, fallback list, and force flags for their being.
  registerOperation("set-being-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, identity, moment }) => {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          "set-being-llm requires an authenticated being.",
        );
      }
      assertFlagMutex(params || {});
      const normalized = { ...(params || {}) };
      if (normalized.connections === undefined && normalized.connectionId !== undefined) {
        normalized.connections = normalized.connectionId === null ? [] : [normalized.connectionId];
        normalized.slot = normalized.slot || "default";
        delete normalized.connectionId;
      }
      const written = await writeLlmFields("being", String(identity.beingId), normalized, identity, moment);
      log.verbose("llm-assigner",
        `being ${identity.beingId} LLM updated: ${Object.keys(written).join(", ") || "(no fields)"}`);
      return { beingId: String(identity.beingId), written };
    },
  });

  // preview-llm-chain retired as a DO op — it's a pure read of the
  // 7-step resolution chain. Registered below as `llm-chain` SEE op.

  // ── SEE ops (read-only perceptions, no Fact stamped) ──
  //
  // `llm-connections` — the caller's LLM connections + slot assignments.
  // `llm-chain`       — the 7-step resolution chain preview.
  //
  // Both are seed-owned (bare names, no prefix). Ables can declare
  // canSee: ["llm-connections"] to preload the connections list as a
  // face block. Direct callers (the portal) invoke story.see("llm-chain", {...}).
  registerSeeOperation("llm-connections", {
    ownerExtension: "seed",
    description: "The caller's LLM connections and slot assignments",
    handler: async ({ identity }) => {
      if (!identity?.beingId) return { connections: [], slots: null };
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

  registerSeeOperation("llm-chain", {
    ownerExtension: "seed",
    description: "The 7-step LLM resolution chain preview for a (receiver, actor, able) triple",
    args: {
      receiverBeingId:   { type: "text", label: "Receiver being id",   required: false },
      receiverBeingName: { type: "text", label: "Receiver being name", required: false },
      receiverSpaceId:   { type: "text", label: "Receiver space id",   required: false },
      actorBeingId:      { type: "text", label: "Actor being id",      required: false },
      actorBeingName:    { type: "text", label: "Actor being name",    required: false },
      actorSpaceId:      { type: "text", label: "Actor space id",      required: false },
      able:              { type: "text", label: "Able",                required: false },
      history:           { type: "text", label: "History",             required: false },
    },
    handler: async ({ identity, args, history }) => {
      let {
        receiverBeingId = null,
        receiverBeingName = null,
        receiverSpaceId = null,
        actorBeingId = null,
        actorBeingName = null,
        actorSpaceId = null,
        able = "main",
      } = args || {};
      const effectiveHistory = args?.history || history || "0";
      // Default the actor to the SEE caller when not specified.
      if (!actorBeingId && !actorBeingName && identity?.beingId) {
        actorBeingId = String(identity.beingId);
      }
      // Name → id resolution.
      if (!receiverBeingId && receiverBeingName) {
        const row = await findBeingByName(String(receiverBeingName));
        if (row) receiverBeingId = String(row._id);
      }
      if (!actorBeingId && actorBeingName) {
        const row = await findBeingByName(String(actorBeingName));
        if (row) actorBeingId = String(row._id);
      }
      if (actorBeingId && !actorSpaceId) {
        const { loadProjection: _lp } = await import("../../../materials/projections.js");
        const actorSlot = await _lp("being", actorBeingId, effectiveHistory);
        actorSpaceId = actorSlot?.state?.position || actorSlot?.state?.homeSpace || null;
      }
      if (!receiverBeingId) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, "`receiverBeingId` or `receiverBeingName` is required");
      }
      const { resolveLlmConnectionChain } = await import("../../cognition/llm/resolution.js");
      const { chain, reason } = await resolveLlmConnectionChain({
        receiver: { beingId: receiverBeingId, spaceId: receiverSpaceId, storyDomain: null },
        actor: actorBeingId ? { beingId: actorBeingId, spaceId: actorSpaceId, storyDomain: null } : null,
        able,
        history: effectiveHistory,
      });
      const { loadProjection } = await import("../../../materials/projections.js");
      const beingsToLookup = new Map();
      if (receiverBeingId) beingsToLookup.set("receiver", String(receiverBeingId));
      if (actorBeingId) beingsToLookup.set("actor", String(actorBeingId));
      const connsBySide = {};
      for (const [side, beingId] of beingsToLookup) {
        const slot = await loadProjection("being", beingId, "0");
        const conns = (slot?.state?.qualities instanceof Map
          ? slot.state.qualities.get("llmConnections")
          : slot?.state?.qualities?.llmConnections) || {};
        connsBySide[side] = conns;
      }
      const enriched = chain.map((entry) => {
        const isActor = entry.source.startsWith("actor-");
        const conns = connsBySide[isActor ? "actor" : "receiver"] || {};
        const conn = conns[entry.connectionId] || null;
        return {
          step: entry.step,
          source: entry.source,
          connectionId: entry.connectionId,
          name: conn?.name || null,
          model: conn?.model || null,
        };
      });
      return {
        chain: enriched,
        reason,
        chosen: enriched.length > 0 ? enriched[0] : null,
      };
    },
  });

  log.verbose("llm-assigner", "registered 6 DO ops + 2 SEE ops (seed: add-llm/delete-llm/assign-slot/set-being-llm/set-space-llm/set-story-llm + 2 SEE: llm-connections/llm-chain)");
}