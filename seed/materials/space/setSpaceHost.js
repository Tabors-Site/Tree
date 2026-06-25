// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// setSpaceHost.js — the floor see-op for set-space.word (space/ops.js, the set-space DO op).
//
// The CONTROL strand (the `field`-required gate + the return) is the .word; the genuine substrate
// READS + reads-side hygiene this op needs are one host see-op, `resolve-set-space-spec`:
//   - the sibling-NAME availability check (assertNameAvailableAt — reads the projection),
//   - the heaven-space ROW read (the immutability gate: heaven spaces refuse name/type changes),
//   - the COORD-BOUNDS check against the PARENT's size (reads two space rows, throws out-of-bounds),
//   - the `maxSpaceSize` config read inside assertValidSpaceSize (reads config + throws),
//   - the ancestor-chain cache invalidation (read-after-write hygiene, run on every set-space).
// It REUSES the SAME primitives the JS handler called (detectTargetKind / targetIdOf / loadTargetRow /
// loadOrFold / assertValidSpaceName / assertValidSpaceType / assertValidSpaceSize / assertNameAvailableAt
// / invalidateSpace); it reimplements nothing. The .word reaches it through `see`; the dispatcher lays
// the one do:set-space fact from the returned factParams. A host throw is the .word's refusal — a READ.
//
// THE BLOCK it returns is { spaceId, factParams } where factParams is the EXACT fact shape the
// dispatcher stamped from ctx.params before this conversion: { field, value } plus `merge` ONLY when
// the caller passed it (byte-identity — the reducers default merge!==false). spaceId is the fact
// TARGET (a typed-space target's id, OR a stance's .spaceId — the .word promotes it via idFrom:"spaceId",
// matching the handler's two factTarget shapes). applySetField folds the scalar fields, applySetQualities
// the qualities paths — unchanged. NORMALIZED name/type are used for the THROW + the uniqueness check
// only; the fact records the caller's ORIGINAL value, exactly as ctx.params did before.

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { detectTargetKind, targetIdOf, loadTargetRow } from "../_targetShape.js";
import {
  assertValidSpaceName,
  assertValidSpaceType,
  assertValidSpaceSize,
  assertNameAvailableAt,
} from "./spaces.js";

// Namespaces NOT writable through set-space qualities (each has its own verb). Mirrors the set kept
// in space/ops.js (the handler's RESERVED_SET_META_NS).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

export function setSpaceHostEnv() {
  return {
    // resolve-set-space-spec — the genuine substrate read + the read-after-write cache hygiene.
    // Routes on the field exactly as the old setOnSpaceHandler did (typed-space AND stance paths),
    // runs the reads that can't be native Word, and returns { spaceId, factParams } — the canonical
    // do:set-space fact shape + its target id. The .word's `If no field` gate runs FIRST. NO fact laid.
    "resolve-set-space-spec": async ({ args: [target, field, value, merge, branch] }, ctx) => {
      // Field guard (the handler's combined `!field || typeof field !== "string"`): the .word's
      // `If no field` gate catches absent/null/empty; this re-states the type half so a non-string
      // field surfaces the SAME clean Error, never a raw TypeError on .startsWith below.
      if (!field || typeof field !== "string") {
        throw new Error("set-space: `field` is required");
      }
      const moment = ctx?.moment;
      const history = branch || moment?.actorAct?.history || "0";
      const kind = detectTargetKind(target);

      // The fact params: { field, value } + merge only when the caller passed it.
      const block = (spaceId, extra = {}) => {
        const fp = { field, value, ...extra };
        if (merge !== undefined && merge !== null) fp.merge = merge;
        return { spaceId: String(spaceId), factParams: fp };
      };

      // Ancestor-chain cache invalidation (read-after-write hygiene): set-space changes
      // qualities / owner / name, all of which getAncestorChain serves. Run on EVERY set-space,
      // exactly as the handler did (best-effort; the cache module may be absent).
      try {
        const { invalidateSpace } = await import("./ancestorCache.js");
        invalidateSpace(String(targetIdOf(target) || ""), moment?.actorAct?.history || null);
      } catch {
        /* cache module unavailable — nothing to invalidate */
      }

      // ── qualities paths ────────────────────────────────────
      if (field.startsWith("qualities.")) {
        const rest = field.slice("qualities.".length);
        const parts = rest.split(".");
        const namespace = parts[0];
        if (RESERVED_SET_META_NS.has(namespace)) {
          throw new Error(
            `set-space: qualities namespace "${namespace}" is not writable through set-space; it has a dedicated verb.`,
          );
        }

        if (kind === "stance") {
          if (parts.length > 2) {
            throw new Error(
              `set-space: deep qualities path "${field}" not supported (max depth: qualities.<namespace>.<innerKey>)`,
            );
          }
          if (!target.spaceId) {
            throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved address has no spaceId");
          }
          // Authorization is the verb dispatcher's able-walk (AblesAreAuth); this trusts it.
          return block(target.spaceId);
        }

        if (parts.length === 1 && value !== null) {
          if (typeof value !== "object") {
            throw new Error("set-space: qualities-namespace value must be an object");
          }
        }
        return block(targetIdOf(target));
      }

      // ── schema-field writes ────────────────────────────────

      if (field === "name") {
        if (!value || typeof value !== "string") {
          throw new Error("set-space: `value` must be a string for field=name");
        }
        const normalized = assertValidSpaceName(value);
        // Single-writer doctrine: validate (access, heaven-space immutability, sibling-name
        // uniqueness), return the shape. The fact records the caller's ORIGINAL value (ctx.params
        // before this conversion); the uniqueness check + immutability gate use the normalized name.
        if (kind === "stance") {
          const spaceId = target?.spaceId;
          if (!spaceId) {
            throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Resolved address has no spaceId");
          }
          const { loadOrFold } = await import("../projections.js");
          const slot = await loadOrFold("space", spaceId, history);
          const row = slot ? { _id: slot.id, ...(slot.state || {}) } : null;
          if (!row) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
          if (row.heavenSpace) throw new Error("set-space: cannot rename heaven spaces");
          if (row.name !== normalized) {
            await assertNameAvailableAt(row.parent, normalized, { excludeSpaceId: String(spaceId) });
          }
          return block(spaceId);
        }
        // Typed-space path. Identical validation; reducer writes.
        const row = await loadTargetRow(target, "space", { moment });
        if (row.heavenSpace) throw new Error("set-space: cannot rename heaven spaces");
        if (row.name !== normalized) {
          await assertNameAvailableAt(row.parent, normalized, { excludeSpaceId: String(row._id) });
        }
        return block(row._id);
      }

      if (field === "type") {
        const spaceId = targetIdOf(target);
        assertValidSpaceType(value); // throws on a bad type; the fact records the ORIGINAL value
        if (kind === "space" && target.heavenSpace) {
          throw new Error("set-space: cannot change type on heaven spaces");
        }
        if (kind === "stance") {
          const { loadOrFold } = await import("../projections.js");
          const slot = await loadOrFold("space", spaceId, history);
          const row = slot ? { heavenSpace: slot.state?.heavenSpace } : null;
          if (!row) throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
          if (row.heavenSpace) throw new Error("set-space: cannot change type on heaven spaces");
        }
        return block(spaceId);
      }

      if (field === "parent") {
        // Bare space-id, null, or the DELETED sentinel string. The fact records the caller's
        // ORIGINAL value (ctx.params before this conversion); only the shape is validated here.
        const { DELETED } = await import("./heavenSpaces.js");
        const spaceId = targetIdOf(target);
        if (value === null || value === undefined) return block(spaceId);
        if (value === DELETED) return block(spaceId);
        if (typeof value !== "string" || !value.length) {
          throw new Error(
            `set-space: parent must be a space id string, null, or the DELETED sentinel . got ${typeof value}`,
          );
        }
        return block(spaceId);
      }

      // owner — a beingId string or null. Handler-level authorization lives in members.js; this
      // validator enforces only the wire shape. The fact records the caller's ORIGINAL value.
      if (field === "owner") {
        if (value !== null && value !== undefined && (typeof value !== "string" || !value.length)) {
          throw new Error("set-space: `owner` value must be a beingId string or null");
        }
        return block(targetIdOf(target));
      }

      // coord: this space's position INSIDE its parent. Shape `{ x, y, z? }` or null. Clamped
      // against the parent's size; out-of-bounds throws. The bounds gate runs on the finite-axis
      // `out`; the fact records the caller's ORIGINAL value (ctx.params before this conversion).
      if (field === "coord") {
        const spaceId = targetIdOf(target);
        if (value === null || value === undefined) return block(spaceId);
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new IbpError(IBP_ERR.INVALID_INPUT, "set-space: coord must be {x, y, z?} or null");
        }
        const out = {};
        for (const a of ["x", "y", "z"]) {
          if (value[a] === undefined) continue;
          if (typeof value[a] !== "number" || !Number.isFinite(value[a])) {
            throw new IbpError(IBP_ERR.INVALID_INPUT, `set-space: coord.${a} must be a finite number`);
          }
          out[a] = value[a];
        }
        if (Object.keys(out).length === 0) {
          throw new IbpError(IBP_ERR.INVALID_INPUT, "set-space: coord requires at least one axis");
        }
        // Bounds-check against the parent's size (same doctrine as set-being:coord — throw, never
        // silently clamp).
        const { loadOrFold } = await import("../projections.js");
        const selfSlot = await loadOrFold("space", spaceId, history);
        const parentId = selfSlot?.state?.parent;
        if (parentId) {
          const parentSlot = await loadOrFold("space", parentId, history);
          const parentSize = parentSlot?.state?.size || null;
          if (parentSize) {
            for (const a of ["x", "y", "z"]) {
              if (out[a] === undefined) continue;
              const cap =
                typeof parentSize[a] === "number" && parentSize[a] > 0 ? parentSize[a] : null;
              if (cap === null) continue;
              const high = Number.isInteger(out[a]) ? Math.trunc(cap) - 1 : cap - Number.EPSILON;
              if (out[a] < 0 || out[a] > high) {
                throw new IbpError(
                  IBP_ERR.INVALID_INPUT,
                  `set-space: coord.${a}=${out[a]} is out of bounds (0..${high} for the parent space)`,
                  { axis: a, value: out[a], cap: high },
                );
              }
            }
          }
        }
        return block(spaceId);
      }

      // size: the space's bounding box. `{ x, y, z? }` or null. assertValidSpaceSize reads the
      // configured maxSpaceSize cap + per-axis rules (throws); null passes through to unset. The
      // fact records the caller's ORIGINAL value (ctx.params before this conversion).
      if (field === "size") {
        const spaceId = targetIdOf(target);
        if (value === null || value === undefined) return block(spaceId);
        assertValidSpaceSize(value, { applyDefault: false });
        return block(spaceId);
      }

      throw new Error(
        `set-space: unknown field "${field}". Supported: name, type, parent, owner, size, coord, qualities.<namespace>[.<innerKey>]`,
      );
    },
  };
}
