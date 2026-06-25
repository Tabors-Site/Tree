// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// setMatterHost.js — the floor see-op for set-matter.word (matter/ops.js, the set-matter DO op).
//
// The CONTROL strand (the `field`-required gate + the return) is the .word; the genuine substrate
// READS this op needs — load the matter row (set-matter needs it for the coord clamp's spaceId and for
// the id-bearing return), the CAS-content existence reads (isCasRef + hasContent — a fact must never
// reference bytes absent from the store), the DELETED-sentinel comparisons (spaceId/beingId soft-delete
// markers), and the COORD-BOUNDS check against the matter's space size (assertMatterCoordInBounds reads
// Space.size and THROWS out-of-bounds) — are one host see-op, `resolve-set-matter-spec`. It REUSES the
// SAME primitives the JS handler called (loadTargetRow + isCasRef/hasContent + DELETED +
// assertMatterCoordInBounds); it reimplements nothing. The .word reaches it through `see`; the
// dispatcher lays the one do:set-matter fact from the returned factParams. Mirrors set-being's
// setBeingHost.js (resolve-set-being-spec) and set-space's setSpaceHost.js (resolve-set-space-spec).
//
// THE BLOCK it returns is { matterId, factParams } where factParams is the EXACT fact shape the
// dispatcher stamped from ctx.params before this conversion: { field, value } plus `merge` ONLY when
// the caller passed it (byte-identity — the reducers default merge!==false). The recorded `value` is
// the caller's ORIGINAL value: the coord check VALIDATES (throws out-of-bounds) but its filtered return
// was NEVER the fact's value — the pre-conversion dispatcher stamped ctx.params.value raw, and
// applySetField folded that raw object. matterId rides OUT of factParams (it is the fact TARGET, not a
// param); the .word promotes it via idFrom:"matterId".
//
// The host throws the SAME Errors / IbpErrors the handler threw — a host throw becomes the .word's
// refusal. It is a READ: it validates, resolves, and RETURNS; it lays no fact and mutates nothing.

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { loadTargetRow } from "../_targetShape.js";
import { assertMatterCoordInBounds } from "./coordBounds.js";

// Namespaces NOT writable through set-matter qualities (each has its own verb). Mirrors the set kept
// in matter/ops.js (the handler's RESERVED_SET_META_NS — empty today, kept for symmetry).
const RESERVED_SET_META_NS = new Set([
  // none today; the set kept for symmetry with space/being
]);

export function setMatterHostEnv() {
  return {
    // resolve-set-matter-spec — the genuine substrate read. Loads the matter row once (passing the
    // moment so an in-moment chain create-matter → set-matter reads the in-flight spec from deltaF),
    // routes on the field exactly as the old setOnMatterHandler did, runs the reads that can't be
    // native Word (CAS existence, DELETED sentinel, coord-bounds), and returns { matterId, factParams }
    // — the canonical do:set-matter fact shape. The .word's `If no field` gate runs FIRST. NO fact laid.
    "resolve-set-matter-spec": async ({ args: [target, field, value, merge, branch] }, ctx) => {
      // Field guard (the handler's combined `!field || typeof field !== "string"`): the .word's
      // `If no field` gate catches the absent/null/empty case; this re-states the type half so a
      // non-string field surfaces the SAME clean Error, never a raw TypeError on .startsWith below.
      if (!field || typeof field !== "string") {
        throw new Error("set-matter: `field` is required");
      }
      const moment = ctx?.moment;
      const history = branch || moment?.actorAct?.history || "0";
      const row = await loadTargetRow(target, "matter", { moment });
      const matterId = String(row._id);
      // The fact params: { field, value } + merge only when the caller passed it (preserves the
      // exact recorded bytes — an absent merge stays absent; the reducers default merge!==false).
      const block = (extra = {}) => {
        const fp = { field, value, ...extra };
        if (merge !== undefined && merge !== null) fp.merge = merge;
        return { matterId, factParams: fp };
      };

      // ── qualities paths ────────────────────────────────────
      if (field.startsWith("qualities.")) {
        const rest = field.slice("qualities.".length);
        const parts = rest.split(".");
        const namespace = parts[0];
        if (RESERVED_SET_META_NS.has(namespace)) {
          throw new Error(
            `set-matter: qualities namespace "${namespace}" is not writable through set-matter; it has a dedicated verb.`,
          );
        }
        if (parts.length === 1 && value !== null) {
          if (typeof value !== "object") {
            throw new Error("set-matter: qualities-namespace value must be an object");
          }
        }
        return block();
      }

      // ── schema-field writes ────────────────────────────────

      if (field === "name") {
        if (!value || typeof value !== "string") {
          throw new Error("set-matter: `value` must be a string for field=name");
        }
        return block();
      }

      // content: the matter's bytes. A CAS ref ({kind:"cas", hash, ...}) the caller has already put
      // into the content store, or null to clear. The handler verifies the hash actually lives in the
      // store so a fact never references missing bytes.
      if (field === "content") {
        if (value === null) return block();
        const { isCasRef, hasContent } = await import("./contentStore.js");
        if (!isCasRef(value)) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            "set-matter: content value must be a CAS ref ({kind:\"cas\", hash, ...}) or null",
          );
        }
        if (!(await hasContent(value.hash))) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `set-matter: unknown content hash "${String(value.hash).slice(0, 12)}..." (bytes not in store)`,
          );
        }
        return block();
      }

      // spaceId: where the matter sits. A bare space-id (transfer) or the DELETED sentinel
      // ("deleted", soft-delete marker).
      if (field === "spaceId") {
        const { DELETED } = await import("../space/heavenSpaces.js");
        if (value === DELETED) return block();
        if (typeof value !== "string" || !value.length) {
          throw new Error(
            `set-matter: spaceId must be a space id string or the DELETED sentinel . got ${typeof value}`,
          );
        }
        return block();
      }

      // beingId: who created the matter. Set-matter uses this only at delete time to record DELETED;
      // the creator is fixed at birth.
      if (field === "beingId") {
        const { DELETED } = await import("../space/heavenSpaces.js");
        if (value === DELETED) return block();
        throw new Error(
          `set-matter: beingId only accepts the DELETED sentinel through set-matter; the creator is fixed at birth`,
        );
      }

      // coord: the matter's position inside spaceId. Same shape as Being.coord — `{ x, y, z? }`
      // checked against Space.size (throw out-of-bounds). The check VALIDATES; the recorded fact
      // carries the caller's ORIGINAL value (the dispatcher stamped ctx.params raw before this
      // conversion, and applySetField folded that raw object), so value stays $value, byte-identical.
      if (field === "coord") {
        if (value === null || value === undefined) return block({ value: null });
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new Error("set-matter: `coord` value must be an object {x,y,z?} or null");
        }
        await assertMatterCoordInBounds(row, value, history);
        return block();
      }

      throw new Error(
        `set-matter: unknown field "${field}". Supported: name, content, spaceId, beingId, coord, qualities.<namespace>[.<innerKey>]`,
      );
    },
  };
}
