// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// setBeingHost.js — the floor see-op for set-being.word (being/ops.js, the set-being DO op).
//
// The CONTROL strand (the `field`-required gate + the return) is the .word; the genuine substrate
// READS this op needs — load the being row, the per-history name-UNIQUENESS check (findByName), and
// the COORD-BOUNDS check against the being's containing space size (assertCoordInBounds reads
// Space.size and THROWS out-of-bounds) — are one host see-op, `resolve-set-being-spec`. It REUSES the
// SAME primitives the JS handler called (loadTargetRow + findByName + assertCoordInBounds); it
// reimplements nothing. The .word reaches it through `see`; the dispatcher lays the one do:set-being
// fact from the returned factParams. Mirrors create-matter's matterHost.js (resolveBirthSpec) and
// rename-matter's renameMatterHost.js (resolveRenameSpec).
//
// THE BLOCK it returns is { beingId, factParams } where factParams is the EXACT fact shape the
// dispatcher stamped from ctx.params before this conversion: { field, value } plus `merge` ONLY when
// the caller passed it (so the recorded fact bytes are byte-identical — the reducers default
// merge!==false) and plus `fromPosition` on a position write (the old handler mutated params.from-
// Position in place; the fact carried it). applySetField folds the scalar fields, applySetQualities
// folds the qualities paths — unchanged. beingId rides OUT of factParams (it is the fact TARGET, not a
// param); the .word promotes it via idFrom:"beingId".
//
// The host throws the SAME Errors / IbpErrors the handler threw — a host throw becomes the .word's
// refusal. It is a READ: it validates, resolves, and RETURNS; it lays no fact and mutates nothing.

import { loadTargetRow } from "../_targetShape.js";
import { assertCoordInBounds } from "./ops.js";

// Namespaces NOT writable through set-being qualities (each has its own verb). Mirrors the set kept
// in being/ops.js (the handler's RESERVED_SET_META_NS).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

export function setBeingHostEnv() {
  return {
    // resolve-set-being-spec — the genuine substrate read. Loads the being row once, routes on the
    // field exactly as the old setOnBeingHandler did, runs the two reads that can't be native Word
    // (name-uniqueness, coord-bounds), and returns { beingId, factParams } where factParams is the
    // canonical do:set-being fact shape. The .word's `If no field` gate runs FIRST, so field is a
    // present string here. NO fact laid.
    "resolve-set-being-spec": async ({ args: [target, field, value, merge, branch] }, ctx) => {
      // Field guard (the handler's combined `!field || typeof field !== "string"`): the .word's
      // `If no field` gate catches the absent/null/empty case; this re-states the type half so a
      // non-string field surfaces the SAME clean Error, never a raw TypeError on .startsWith below.
      if (!field || typeof field !== "string") {
        throw new Error("set-being: `field` is required");
      }
      const moment = ctx?.moment;
      const history = branch || moment?.actorAct?.history || "0";
      const row = await loadTargetRow(target, "being", { moment });
      const beingId = String(row._id);
      // The fact params: { field, value } + merge only when the caller passed it (preserves the
      // exact recorded bytes — an absent merge stays absent; the reducers default merge!==false).
      const block = (extra = {}) => {
        const fp = { field, value, ...extra };
        if (merge !== undefined && merge !== null) fp.merge = merge;
        return { beingId, factParams: fp };
      };

      // ── qualities paths ────────────────────────────────────
      if (field.startsWith("qualities.")) {
        const rest = field.slice("qualities.".length);
        const parts = rest.split(".");
        const namespace = parts[0];
        if (RESERVED_SET_META_NS.has(namespace)) {
          throw new Error(
            `set-being: qualities namespace "${namespace}" is not writable through set-being; it has a dedicated verb.`,
          );
        }
        if (parts.length === 1 && value !== null) {
          if (typeof value !== "object") {
            throw new Error("set-being: qualities-namespace value must be an object");
          }
        }
        return block();
      }

      // ── schema-field writes ────────────────────────────────

      if (field === "name") {
        if (!value || typeof value !== "string") {
          throw new Error("set-being: `value` must be a string for field=name");
        }
        const { findByName } = await import("../projections.js");
        const existing = await findByName("being", value, history);
        if (existing && String(existing.id) !== beingId) {
          throw new Error(`set-being: name "${value}" already taken on history ${history}`);
        }
        return block();
      }

      if (field === "parentBeingId") {
        if (value === null || value === undefined) return block();
        if (typeof value !== "string" || !value.length) {
          throw new Error(
            `set-being: parentBeingId must be a being id string or null . got ${typeof value}`,
          );
        }
        return block();
      }

      if (field === "defaultAble") {
        if (value !== null && value !== undefined && typeof value !== "string") {
          throw new Error(`set-being: \`defaultAble\` value must be a string or null`);
        }
        return block();
      }

      if (field === "homeSpace") {
        if (value === null || value === undefined) return block();
        if (typeof value !== "string" || !value.length) {
          throw new Error(
            `set-being: homeSpace must be a space id string or null . got ${typeof value}`,
          );
        }
        return block();
      }

      // password is bcrypt-hashed by the caller before set-being; the op records the hash.
      if (field === "password") {
        if (typeof value !== "string" || !value.length) {
          throw new Error("set-being: `password` value must be the bcrypt hash string");
        }
        return block();
      }

      // position: the Space this being is in. The DO-side counterpart to be:occupy. The OLD position
      // rides the fact (fromPosition) so the live-SEE hook fan can invalidate BOTH rooms.
      if (field === "position") {
        if (value !== null && value !== undefined && (typeof value !== "string" || !value.length)) {
          throw new Error(
            `set-being: position must be a space id string or null . got ${typeof value}`,
          );
        }
        const newId = value || null;
        const fromId = row?.position || null;
        // The handler set params.fromPosition ONLY when the being actually moved (a truthy old
        // position that differs from the new one) — the live-SEE hint to invalidate BOTH rooms.
        // Reproduce exactly: fromPosition rides the fact iff fromId && fromId !== newId; value stays
        // the raw $value (null on a clear).
        if (fromId && fromId !== newId) return block({ fromPosition: fromId });
        return block();
      }

      // coord: the being's coord inside its position space, clamped to Space.size (throw out-of-bounds).
      if (field === "coord") {
        if (value === null || value === undefined) return block({ value: null });
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new Error("set-being: `coord` value must be an object {x,y,z?} or null");
        }
        // assertCoordInBounds reads Space.size and THROWS out-of-bounds (the genuine gate). The
        // recorded fact carries the ORIGINAL value (the dispatcher stamped ctx.params before this
        // conversion — proven by the pre-conversion ground-truth probe), so the gate runs but its
        // return is not what the fact records; value stays $value, byte-identical to before.
        await assertCoordInBounds(row, value, history);
        return block();
      }

      throw new Error(
        `set-being: unknown field "${field}". Supported: name, defaultAble, homeSpace, parentBeingId, password, position, coord, qualities.<namespace>[.<innerKey>]`,
      );
    },
  };
}
