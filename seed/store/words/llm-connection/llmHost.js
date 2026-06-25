// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llmHost.js — host-escape glue for the llm-connection word cluster (store/words/llm-
// connection/). Each `resolve-*` escape runs the NON-EMITTING floor in connect.js (the E6
// kernels: resolveConnectionSpec / resolveConnectionUpdate / …) and returns the set-being
// params; the `.word` returns them as `factParams` so the DISPATCHER lays the one
// do:set-being fact (skipAudit gone, no self-emit). NO fact is laid here.
//
// The connection rides the fact as ciphertext (encryptedApiKey); redact.js strips
// qualities.llmConnections from every wire surface, so nothing readable leaves the reel.
// A connection is ONE fact however rich (name/url/model/key = the word's content — the
// spacebar; create-matter is the proof). The client-cache bust is a post-fact side-effect
// the op handler does (a cache invalidation, not a fact) — a fold-hook is the proper home.
//
// callHost invokes each escape as `fn({ args: [...] }, ctx)`.

import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { targetIdOf, detectTargetKind } from "../../../materials/_targetShape.js";

export function llmHostEnv() {
  return {
    // add-llm-connection (the MULTI-MOMENT word): validate / SSRF-gate / encrypt the key /
    // mint the id, and read isFirst (no `main` slot yet). Returns the set-being field+value
    // for the FIRST deed (the connection) and isFirst for the SECOND deed (assign-to-main).
    // NO fact (the deeds in add.word lay the facts, each its own moment via runWordToStore).
    "resolve-connection": async ({ args: [target, params] }, ctx) => {
      const p = params || {};
      if (!p.name || !p.baseUrl || !p.model)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "add-llm-connection: `name`, `baseUrl`, and `model` are required");
      const { resolveConnectionSpec } = await import("../../../present/cognition/llm/connect.js");
      const beingId = String(targetIdOf(target));
      const r = await resolveConnectionSpec(
        beingId,
        { name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey || "none", model: p.model },
        { moment: ctx?.moment ?? null },
      );
      return {
        beingId: r.beingId,
        field: r.setBeingParams.field,
        value: r.setBeingParams.value,
        connectionId: r.connectionId,
        isFirst: r.isFirst,
      };
    },

    // update-llm-connection: validate + re-encrypt the changed fields of the target
    // being's connection, bake the merged set-being params. NO fact.
    "resolve-connection-update": async ({ args: [target, params] }, ctx) => {
      const p = params || {};
      if (!p.connectionId)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "update-llm-connection: `connectionId` is required");
      if (!p.baseUrl || !p.model)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "update-llm-connection: `baseUrl` and `model` are required");
      const { resolveConnectionUpdate } = await import("../../../present/cognition/llm/connect.js");
      const beingId = String(targetIdOf(target));
      const r = await resolveConnectionUpdate(
        beingId,
        p.connectionId,
        { name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model },
        { moment: ctx?.moment ?? null },
      );
      return {
        beingId,
        connectionId: r.connectionId,
        wasAssigned: r.wasAssigned,
        setBeingParams: r.setBeingParams,
      };
    },

    // delete-llm-connection: confirm the connection exists, bake the unset params
    // (value:null). ONE fact; the slot-clears run-on is dropped (the dangling ref folds). NO fact.
    "resolve-connection-removal": async ({ args: [target, params] }, ctx) => {
      const p = params || {};
      if (!p.connectionId)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-llm-connection: `connectionId` is required");
      const { resolveConnectionRemoval } = await import("../../../present/cognition/llm/connect.js");
      const beingId = String(targetIdOf(target));
      const r = await resolveConnectionRemoval(beingId, p.connectionId, { moment: ctx?.moment ?? null });
      return { beingId, connectionId: r.connectionId, setBeingParams: r.setBeingParams };
    },

    // assign-llm-slot: validate slot + connection-exists, bake the set params + branch flags
    // (being → set-being / space → set-space). NO fact (the .word's chosen deed lays it).
    "resolve-slot-assignment": async ({ args: [target, params, caller] }, ctx) => {
      const p = params || {};
      if (!p.slot)
        throw new IbpError(IBP_ERR.INVALID_INPUT, "assign-llm-slot: `slot` is required");
      const { resolveSlotAssignment } = await import("../../../present/cognition/llm/connect.js");
      let kind = detectTargetKind(target);
      if (kind === "stance") kind = "space"; // a stance assigns at the space level
      const r = await resolveSlotAssignment(
        targetIdOf(target), kind, p.slot, p.connectionId ?? null,
        { caller, moment: ctx?.moment ?? null },
      );
      return r;
    },
  };
}
