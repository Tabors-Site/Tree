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
import { registerOperation } from "../../../ibp/operations.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { findBeingByName } from "../../../materials/being/identity.js";
import { llmConfigHostEnv } from "./llmAssignerHost.js";

const OWNER = "llm-assigner";

// Self-register the co-located world strands so resolveAbleWord(noun, <op>) finds them. The three
// set-*-llm ops are WORD-SOLE: each `.word` is the ONLY path (do.js runOpWordToStore runs it via
// runWordToStore — runAsStore — so each set-being/set-space field write seals its own moment). The
// lone host floor resolve-llm-config (llmAssignerHostEnv) does the genuine read + (story) heaven-
// authority gate + the writeLlmFields field-building, and returns the { field, value } write list;
// the deeds lay the per-field facts. No JS handler.
registerAbleWord("being", "set-being-llm", new URL("./set-being-llm.word", import.meta.url));
registerAbleWord("space", "set-space-llm", new URL("./set-space-llm.word", import.meta.url));
registerAbleWord("space", "set-story-llm", new URL("./set-story-llm.word", import.meta.url));

// The three connection-management ops are WORD-SOLE delegators (CONVERTING.md): each `.word`
// lays ONE entailed deed on the caller's own being — `do add-llm-connection` / `do assign-llm-slot`
// / `do delete-llm-connection`, the seed ops that are themselves word-SOLE. Pure composition, words
// all the way down: no handler, no host read (a delegator reads nothing of the floor), ranAsMoments
// so the op stamps none of its own — the entailed deed's fact IS the record. dispatch noun "being".
registerAbleWord("being", "add-llm",     new URL("./add-llm.word", import.meta.url));
registerAbleWord("being", "assign-slot", new URL("./assign-slot.word", import.meta.url));
registerAbleWord("being", "delete-llm",  new URL("./delete-llm.word", import.meta.url));

// ────────────────────────────────────────────────────────────────────
// 7-step chain helpers (auth.jpg)
// ────────────────────────────────────────────────────────────────────
//
// The set-*-llm ops accept `{slot, connections, forceActor, forceReceiver,
// preferOwn}` plus the legacy `{slot, connectionId}` shape. The whole
// field-building (legacy-normalize, force-flag mutex, slot validate, the
// dotted-path { field, value } write list) is now the host floor
// resolveLlmConfigSpec (present/cognition/llm/connect.js), reached through
// resolve-llm-config (llmAssignerHost.js). The set-*-llm `.word`s fan each
// write out as its own do:set-being / do:set-space deed (one moment per
// field via runWordToStore), exactly as the old writeLlmFields doVerb loop.

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

  // Add an LLM connection to the caller's own being. WORD-SOLE: add-llm.word is the only path
  // (do.js runOpWordToStore via runWordToStore — runAsStore — so the entailed deed seals its own
  // moment). The `.word` is a PURE-COMPOSITION delegator: it lays ONE deed `do add-llm-connection`
  // on the caller's own being with { name, baseUrl, model, apiKey } — itself a word-SOLE seed op
  // that validates / SSRF-gates / encrypts / mints and auto-binds "main" on the being's first
  // connection. No handler, no hostEnv (a delegator reads nothing of the floor); ranAsMoments, so
  // the op lays NO fact of its own — the entailed do:add-llm-connection deed IS the record.
  registerOperation("add-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "being", able: "add-llm", ranAsMoments: true },
  });

  // Bind one of the caller's connections to a slot on their own being. WORD-SOLE: assign-slot.word
  // is the only path (runOpWordToStore / runAsStore). The `.word` lays ONE deed `do assign-llm-slot`
  // on the caller's own being with { slot, connectionId } — the word-SOLE seed op that writes
  // Being.qualities.beingLlm.slots.<slot> (connectionId omitted/null clears the slot). No handler,
  // no hostEnv; ranAsMoments, so the op lays NO fact of its own — the deed's fact IS the record.
  registerOperation("assign-slot", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "being", able: "assign-slot", ranAsMoments: true },
  });

  // List the caller's connections + current slot assignments.
  // list-llms retired as a DO op. The caller's connections are a
  // read-only perception → registered below as `llm-connections` SEE
  // op (see registerSeeOperation block at the bottom of this file).

  // Delete one of the caller's connections. WORD-SOLE: delete-llm.word is the only path
  // (runOpWordToStore / runAsStore). The `.word` lays ONE deed `do delete-llm-connection` on the
  // caller's own being with { connectionId } — the word-SOLE seed op that unsets
  // qualities.llmConnections.<id> (the dangling slot refs fold to absent). No handler, no hostEnv;
  // ranAsMoments, so the op lays NO fact of its own — the deed's fact IS the record.
  registerOperation("delete-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "being", able: "delete-llm", ranAsMoments: true },
  });

  // Set the story-level LLM configuration on the place root's
  // `qualities.llm`. WORD-SOLE: set-story-llm.word is the only path (do.js runOpWordToStore via
  // runWordToStore — runAsStore). The host floor resolve-llm-config (mode "story") runs the
  // heaven-authority gate (hasHeavenAuthority — owner or angel able), resolves the place root
  // (findRoot), legacy-normalizes (default slot "default"), runs the force-flag mutex, validates
  // the slot, and builds the { field, value } write list; the `.word` fans each out as its own
  // do:set-space deed (one moment per field). No JS handler.
  registerOperation("set-story-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "space", able: "space", runAsStore: true },
    hostEnv: llmConfigHostEnv("story"),
  });

  // Set an LLM configuration on a space the caller owns. WORD-SOLE: set-space-llm.word is the only
  // path (runOpWordToStore / runAsStore). resolve-llm-config (mode "space") reads Space.exists on
  // params.spaceId (SPACE_NOT_FOUND on absence), legacy-normalizes (default slot "default"), runs
  // the mutex, validates the slot, and builds the write list; the `.word` fans each out as its own
  // do:set-space deed. No JS handler.
  registerOperation("set-space-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "space", able: "space", runAsStore: true },
    hostEnv: llmConfigHostEnv("space"),
  });

  // Set the calling being's own LLM configuration. WORD-SOLE: set-being-llm.word is the only path
  // (runOpWordToStore / runAsStore). resolve-llm-config (mode "being") targets the caller's own
  // being, legacy-normalizes, runs the mutex, validates the slot, and builds the write list; the
  // `.word` fans each out as its own do:set-being deed (one moment per field). No JS handler.
  registerOperation("set-being-llm", {
    targets: ["space"],
    ownerExtension: "seed",
    word: { noun: "being", able: "being", runAsStore: true },
    hostEnv: llmConfigHostEnv("being"),
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