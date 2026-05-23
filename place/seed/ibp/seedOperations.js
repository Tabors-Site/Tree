// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed DO operations. My native vocabulary.
//
// Every DO action that touches the substrate flows through the
// registry in operations.js. The actions extensions add are their
// own concerns; the actions the seed needs to be itself live here.
// I register them at module load through the same surface extensions
// use — no privileged seed path, no special treatment. The bare
// names are reserved for me because they describe the substrate
// shape; extensions get prefixes so every action's owner is
// structurally evident.
//
// What I ship:
//
//   birth                  (bring a material into existence under a target)
//   set                    (write a field; schema or qualities path)
//   death                  (chain-disconnect — soft-delete a material)
//   plant                  (scaffold install; one act fans into many writes)
//
//   add-llm-connection     (being — thin wrapper; emits a `set` Fact)
//   update-llm-connection  (being — same)
//   delete-llm-connection  (being — same)
//   assign-llm-slot        (polymorphic over being/space; multi-write coord)
//   install-extension      (write files; reload-required)
//   uninstall-extension    (remove files; reload-required)
//   enable-extension       (toggle disabledExtensions list)
//   disable-extension      (toggle disabledExtensions list)
//   set-config             (place config key/value write — protected keys)
//   delete-config          (place config key removal)
//
// Retired 2026-05-23 (folded into birth/set/death/plant):
//   create-child, create-matter, set-name, set-type, set-parent,
//   delete-space, delete-matter, set-qualities, plant-seed
//

import { registerOperation, getOperation } from "./operations.js";
import {
  createSpace,
  editSpaceName,
  editSpaceType,
  deleteSpaceBranch,
  updateParentRelationship,
  assertValidSpaceName,
  assertValidSpaceType,
  assertNameAvailableAt,
} from "../materials/space/spaceManagement.js";
import { resolveSpaceAccess } from "../materials/space/spaceFetch.js";
import { getPlaceDomain } from "../ibp/address.js";
import { IbpError, IBP_ERR, mapPatternsToIbpError } from "./protocol.js";
import Being from "../models/being.js";
import Matter from "../models/matter.js";
import Space from "../models/space.js";

import { qualities } from "../materials/qualities.js";
import { v4 as uuidv4 } from "uuid";

let _registered = false;

/**
 * Register the seed DO operations. Idempotent; calling twice is a no-op.
 * Invoked by services.js at module load so the registry is populated
 * before anyone dispatches.
 */
export function registerSeedOperations() {
  if (_registered) return;
  _registered = true;

  // create-being moved to BE 2026-05-20. Creating a being is an
  // identity operation, not a state mutation on space or matter, so
  // it belongs on the BE verb. Callers now use:
  //
  //   await place.be("create-being", {
  //     name, password, operatingMode, role,
  //     homeSpace | homeParent, parentBeingId?,
  //   })
  //
  // The handler lives on the auth-being's `createBeing` method (see
  // seed/present/roles/cherub.js). Per the philosophy notes: BE acts on
  // the being calling it, and identity creation is the BE side of the
  // grammar.
  //
  // The earlier named ops (create-child, create-matter, set-name,
  // set-type, set-parent, delete-space, delete-matter, set-qualities,
  // plant-seed) retired 2026-05-23. Their work folded into the four
  // collapsed verbs below — birth, set, death, plant — which dispatch
  // to the same helpers via switch on params. See the corresponding
  // handlers below for the mapping.

  // ────────────────────────────────────────────────────────────────
  // LLM connections — per-Being LLM provider credentials.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: the Being that owns the connection. Connection records are
  // stored in the LlmConnection collection, indexed by beingId. The ops
  // wrap the seed/present/voices/llm/connect.js helpers; the IBP grammar gives
  // them a single dispatch surface.

  // The add/update/delete-llm-connection DO ops are kept as
  // operator/CLI-facing surfaces, but their handlers delegate to the
  // shared helpers in connect.js which now route writes through
  // `do.set`. `skipAudit: true` prevents double-Fact: the inner set
  // call emits the canonical Fact; this outer op is just the shape
  // CLI clients reach for.
  registerOperation("add-llm-connection", {
    targets: ["being"],
    ownerExtension: "seed",
    skipAudit: true,
    handler: async ({ target, params, identity }) => {
      const { name, baseUrl, apiKey, model } = params || {};
      if (!name || !baseUrl || !model) {
        throw new Error(
          "add-llm-connection: `name`, `baseUrl`, and `model` are required",
        );
      }
      const { addLlmConnection, assignConnection } =
        await import("../factory/voices/llm/connect.js");
      const beingId = String(target._id);
      const connection = await addLlmConnection(
        beingId,
        { name, baseUrl, apiKey: apiKey || "none", model },
        { identity },
      );
      // If this is the Being's first connection, auto-assign it to the
      // default `main` slot so subsequent runTurn calls find an LLM.
      try {
        if (!target.llmDefault) {
          await assignConnection(beingId, "main", connection._id);
        }
      } catch {}
      return { connection };
    },
  });

  registerOperation("update-llm-connection", {
    targets: ["being"],
    ownerExtension: "seed",
    skipAudit: true,
    handler: async ({ target, params, identity }) => {
      const { connectionId, name, baseUrl, apiKey, model } = params || {};
      if (!connectionId)
        throw new Error("update-llm-connection: `connectionId` is required");
      if (!baseUrl || !model) {
        throw new Error(
          "update-llm-connection: `baseUrl` and `model` are required",
        );
      }
      const { updateLlmConnection } =
        await import("../factory/voices/llm/connect.js");
      const connection = await updateLlmConnection(
        String(target._id),
        connectionId,
        { name, baseUrl, apiKey, model },
        { identity },
      );
      return { connection };
    },
  });

  registerOperation("delete-llm-connection", {
    targets: ["being"],
    ownerExtension: "seed",
    skipAudit: true,
    handler: async ({ target, params, identity }) => {
      const { connectionId } = params || {};
      if (!connectionId)
        throw new Error("delete-llm-connection: `connectionId` is required");
      const { deleteLlmConnection } =
        await import("../factory/voices/llm/connect.js");
      await deleteLlmConnection(String(target._id), connectionId, { identity });
      return { removed: true, connectionId };
    },
  });

  // Bind an LLM slot to a connection (or unbind by passing null).
  // Polymorphic across Being and Space targets — the resolution chain
  // walks both, so slot assignment lives at both:
  //
  //   Being target → Being.llmDefault (slot="main") or
  //                  Being.qualities.beingLlm.slots.<slot>
  //   Space  target → Space.llmDefault  (slot="main") or
  //                  Space.qualities.llm.slots.<slot>
  registerOperation("assign-llm-slot", {
    targets: ["being", "space"],
    ownerExtension: "seed",
    handler: async ({ target, params, identity }) => {
      const { slot, connectionId } = params || {};
      if (!slot) throw new Error("assign-llm-slot: `slot` is required");
      const kind = detectTargetKind(target);
      const { assignConnection, assignSpaceConnection } =
        await import("../factory/voices/llm/connect.js");
      if (kind === "being") {
        return assignConnection(String(target._id), slot, connectionId || null);
      }
      const spaceId = targetIdOf(target);
      if (!spaceId)
        throw new Error("assign-llm-slot: target must resolve to a space id");
      return assignSpaceConnection(spaceId, slot, connectionId || null, {
        ownerBeingId: identity?.beingId || null,
      });
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Extension management — per [[project_everything_is_substrate]],
  // installed-state is substrate. These ops drive the loader.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: any space on this place — typically the place root. The
  // extension's installed-state isn't bound to a particular space; the
  // target lets stance authorization gate who can install.

  // Extension management ops (install / uninstall / enable / disable)
  // are NOT registered here. They live in extensions/loader.js because
  // their handlers touch loader-internal state (filesystem writes,
  // disabledExtensions sync file). Seed must not import from the loader,
  // so the dependency points the other way: the loader calls
  // registerExtensionManagementOps() at boot. See
  // [[CLAUDE.md]] — "Seed never imports from extensions."

  // ────────────────────────────────────────────────────────────────
  // Place config — flat key/value store on the .config place seed space.
  // ────────────────────────────────────────────────────────────────
  //
  // Place config is one of the meta-positions ([[project_meta_positions]]):
  // `<place>/.config` resolves to the SEED_SPACE.CONFIG space. Reads go
  // through `ibp:see` on that address (returns the cached config snapshot);
  // writes go through these DO ops which wrap the seed's
  // setPlaceConfigValue helper. The helper handles cache invalidation,
  // validation, and PROTECTED_KEYS gating.

  registerOperation("set-config", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, scaffold }) => {
      const { key, value } = params || {};
      if (!key || typeof key !== "string") {
        throw new Error("set-config: `key` is required");
      }
      if (value === undefined) {
        throw new Error(
          "set-config: `value` is required (use delete-config to remove)",
        );
      }
      // Scaffold flows (migrations, first-boot bootstrap) are permitted
      // to write PROTECTED_KEYS (seedVersion, disabledExtensions). Being
      // calls never carry scaffold and stay subject to the protected-key
      // gate in placeConfig.js.
      const { setPlaceConfigValue } = await import("../placeConfig.js");
      await setPlaceConfigValue(key, value, { internal: scaffold === true });
      return { key, value };
    },
  });

  registerOperation("delete-config", {
    targets: ["space"],
    ownerExtension: "seed",
    handler: async ({ params, scaffold }) => {
      const { key } = params || {};
      if (!key || typeof key !== "string") {
        throw new Error("delete-config: `key` is required");
      }
      const { deletePlaceConfigValue } = await import("../placeConfig.js");
      await deletePlaceConfigValue(key, { internal: scaffold === true });
      return { deleted: true, key };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // THE FOUR — birth, set, death, plant.
  //
  // The collapsed DO surface. Every mutation to space / matter / being
  // (and the connections that ride on them) goes through one of these.
  // Handlers call the underlying helpers directly — no indirection
  // through the older named ops above. The named ops above remain
  // registered for the migration window; once all callers have moved
  // to this surface they retire.
  // ────────────────────────────────────────────────────────────────

  // birth: bring a material into existence under target.
  //   params: { kind: "space"|"matter", spec: {...} }
  //   (kind "being" is reserved for BE.register; minting identity
  //    belongs on the BE verb, not DO.)
  registerOperation("birth", {
    targets: ["space", "matter", "being"],
    ownerExtension: "seed",
    factAction: "birth",
    handler: async (ctx) => {
      const { target, params, identity } = ctx;
      const { kind, spec = {} } = params || {};
      if (!kind) throw new Error("birth: `kind` is required (space|matter)");
      if (kind === "being") {
        throw new Error(
          "birth: kind 'being' belongs on BE.register, not DO.birth",
        );
      }
      const targetKind = detectTargetKind(target);
      if (kind === "space") {
        return createSpaceChild({
          target,
          params: spec,
          identity,
          kind: targetKind,
        });
      }
      if (kind === "matter") {
        // Converted to fact-driven (2026-05-23). The handler:
        //   1. allocates the new matter's id,
        //   2. enriches the spec with derived fields (spaceId, parentMatterId,
        //      beingId) so the reducer can produce the full row state from
        //      the fact alone,
        //   3. mutates ctx.params so the verb dispatcher's logFact stamps
        //      the enriched spec onto the fact,
        //   4. returns _factTarget so the fact targets the new matter's reel.
        //
        // The actual Matter row is created by the reducer + initProjection
        // chain inside eager-fold (see materials/reducerHelpers.js
        // applyBirthMatter + foldEngine.js rebuild). No Matter.create here.
        const matterId = uuidv4();
        const spaceId = targetKind === "space" ? targetIdOf(target) : (spec.spaceId ?? null);
        const parentMatterId = targetKind === "matter" ? String(target._id) : (spec.parentMatterId ?? null);
        const enrichedSpec = {
          ...spec,
          spaceId,
          parentMatterId,
          beingId: identity?.beingId || spec.beingId || null,
          origin: spec.origin || "ibp",
        };
        // Replace ctx.params (NOT the caller's input) with the enriched
        // version so the verb dispatcher's logFact stamps the enriched
        // spec onto the fact. The dispatcher reads ctx.params after the
        // handler returns; we reassign on ctx, not on the destructured
        // local, so the caller's input object stays untouched.
        ctx.params = { ...params, spec: enrichedSpec };
        return {
          matterId,
          _factTarget: { kind: "matter", id: matterId },
        };
      }
      throw new Error(`birth: unknown kind "${kind}"`);
    },
  });

  // set: write a field on target.
  //   params: { field, value, merge=true }
  //   field paths:
  //     "name" / "type" / "parent" / "llmDefault"  → schema-field writes
  //     "qualities.<namespace>"                    → set/merge that namespace
  //     "qualities.<namespace>.<innerKey>"         → merge one inner key
  //     value=null on a qualities path             → unset
  registerOperation("set", {
    targets: ["space", "being", "matter"],
    ownerExtension: "seed",
    factAction: "set",
    handler: async ({ target, params, identity }) => {
      const { field, value, merge = true } = params || {};
      if (!field || typeof field !== "string") {
        throw new Error("set: `field` is required");
      }
      const kind = detectTargetKind(target);

      // ── qualities paths ────────────────────────────────────
      //
      // Converted to fact-driven (2026-05-22). The handler validates
      // input + resolves the target, but DOES NOT write the qualities
      // value. The actual write happens inside the verb dispatcher's
      // logFact → eager-fold pipeline: the fact is stamped, the
      // reducer (see seed/materials/reducerHelpers.js applySetQualities)
      // derives the new qualities state, and applyProjection writes
      // it. One projection-writer in the system — fold — per STAMPER.md.
      //
      // Per-reel append lock serializes concurrent writes to the same
      // aggregate; the atomic-per-subpath property that the legacy
      // direct-Mongo path used to provide is now serialized via the
      // lock + reducer recompute (read-current-state, set sub-path,
      // write-back). Different aggregates remain parallel.
      if (field.startsWith("qualities.")) {
        const rest = field.slice("qualities.".length);
        const parts = rest.split(".");
        const namespace = parts[0];
        if (RESERVED_SET_META_NS.has(namespace)) {
          throw new Error(
            `set: qualities namespace "${namespace}" is not writable through set; it has a dedicated verb.`,
          );
        }

        if (kind === "stance") {
          if (parts.length > 2) {
            throw new Error(
              `set: deep qualities path "${field}" not supported (max depth: qualities.<namespace>.<innerKey>)`,
            );
          }
          // Resolve the stance to a space id for auth + audit. The
          // reducer fold consumes the fact stamped after the handler
          // returns; it writes the projection. We only validate + auth.
          if (!target.spaceId) {
            throw new IbpError(
              IBP_ERR.SPACE_NOT_FOUND,
              "Resolved address has no spaceId",
            );
          }
          const access = await resolveSpaceAccess(
            target.spaceId,
            identity?.beingId || null,
          );
          if (!access?.ok || access.write !== true) {
            throw new IbpError(
              IBP_ERR.FORBIDDEN,
              "Not authorized to write qualities at this place",
            );
          }
          return {
            written: true,
            spaceId: String(target.spaceId),
            namespace,
            kind: "space",
            _factTarget: { kind: "space", id: String(target.spaceId) },
          };
        }

        if (parts.length === 1 && value !== null) {
          if (typeof value !== "object") {
            throw new Error("set: qualities-namespace value must be an object");
          }
        }

        return {
          written: true,
          [`${kind}Id`]: String(target._id),
          ...(parts.length === 1 ? { namespace } : { field }),
          ...(value === null ? { unset: true } : {}),
        };
      }

      // ── schema-field writes ────────────────────────────────
      //
      // Converted to fact-driven (2026-05-22). The handler validates
      // (uniqueness, format, sibling-collision) but does NOT write the
      // field. The actual write happens in the verb dispatcher's
      // logFact → eager-fold → reducer chain (see reducerHelpers.js
      // applySetField). Stance branches still go through the legacy
      // helpers — converting them needs the stance-resolver path
      // rewired too.
      if (field === "name") {
        if (!value || typeof value !== "string") {
          throw new Error("set: `value` must be a string for field=name");
        }
        if (kind === "being") {
          const existing = await Being.findOne({ name: value }).select("_id");
          if (existing && String(existing._id) !== String(target._id)) {
            throw new Error(`set: name "${value}" already taken`);
          }
          return { beingId: String(target._id), name: value };
        }
        if (kind === "matter") {
          return { matterId: String(target._id), name: value };
        }
        if (kind === "stance") {
          // Stance-shaped target still legacy until the stance resolver
          // path is rewired. Calls editSpaceName which writes directly.
          return renameAtStance({ resolved: target, name: value, identity });
        }
        // space (Mongoose doc passed directly). Validate name format +
        // sibling collision; reducer writes the projection.
        const normalized = assertValidSpaceName(value);
        if (target.seedSpace) {
          throw new Error("set: cannot rename place seed spaces");
        }
        if (target.name !== normalized) {
          await assertNameAvailableAt(target.parent, normalized, {
            excludeSpaceId: String(target._id),
          });
        }
        return { spaceId: String(target._id), name: normalized };
      }

      if (field === "type") {
        if (kind !== "space" && kind !== "stance") {
          throw new Error("set: `type` is only settable on Space");
        }
        const spaceId = targetIdOf(target);
        const normalized = assertValidSpaceType(value);
        if (kind === "space" && target.seedSpace) {
          throw new Error("set: cannot change type on place seed spaces");
        }
        if (kind === "stance") {
          // Stance still legacy until rewired.
          await editSpaceType({
            spaceId,
            newType: normalized,
            beingId: identity?.beingId || null,
          });
        }
        return { spaceId, type: normalized };
      }

      if (field === "parent") {
        if (kind !== "space" && kind !== "stance") {
          throw new Error("set: `parent` is only settable on Space");
        }
        const spaceId = targetIdOf(target);
        const result = await updateParentRelationship(
          spaceId,
          value,
          identity?.beingId || null,
        );
        return result || { spaceId, parentId: value };
      }

      if (field === "llmDefault") {
        // assign-llm-slot still owns the multi-write coordination for
        // LLM slot assignment (validates connection ownership, clears
        // caches). Delegate through it for now; Phase 3.C (LlmConnection
        // drop) will rework the whole LLM-slot surface.
        const op = getOperation("assign-llm-slot");
        if (!op)
          throw new Error(
            "set: assign-llm-slot not registered (required for field=llmDefault)",
          );
        return op.handler({
          target,
          params: { slot: "main", connectionId: value || null },
          identity,
        });
      }

      throw new Error(
        `set: unknown field "${field}". Supported: name, type, parent, llmDefault, qualities.<namespace>[.<innerKey>]`,
      );
    },
  });

  // death: chain-disconnect the target from the projection. The
  // birth-Fact remains in the chain; the fold respects the death-Fact
  // and the material (and its subtree where it has one) stops
  // appearing in the stamp face going forward.
  registerOperation("death", {
    targets: ["space", "matter"],
    ownerExtension: "seed",
    factAction: "death",
    handler: async ({ target, identity, summonCtx }) => {
      const kind = detectTargetKind(target);
      if (kind === "space") {
        const spaceId = targetIdOf(target);
        const deleted = await deleteSpaceBranch(
          spaceId,
          identity?.beingId || null,
        );
        return { deathSpaceId: String(deleted?._id || spaceId) };
      }
      if (kind === "matter") {
        const matterId = String(target?._id || target?.matterId || target);
        if (!matterId) throw new Error("death: matterId required");
        const { deleteMatterAndFile } =
          await import("../materials/matter/matters.js");
        const beingId =
          identity?.beingId ||
          (await Matter.findById(matterId).select("beingId").lean())?.beingId;
        await deleteMatterAndFile({
          matterId,
          beingId: String(beingId || ""),
          actId: summonCtx?.actId || null,
          sessionId: summonCtx?.sessionId || null,
        });
        return { removed: true, matterId };
      }
      throw new Error(`death: unsupported target kind "${kind}"`);
    },
  });

  // plant: scaffold install. One act, many writes (the seed recipe
  // materializes a whole structure under target).
  //   params: { seed, spec }
  registerOperation("plant", {
    targets: ["space"],
    ownerExtension: "seed",
    factAction: "plant",
    handler: async ({ target, params, identity }) => {
      const { seed, spec } = params || {};
      if (!seed || typeof seed !== "string") {
        throw new Error(
          "plant: `seed` is required (the seed's registered name)",
        );
      }
      const spaceId = targetIdOf(target);
      if (!spaceId) throw new Error("plant: target must resolve to a space id");
      const { plantSeed } = await import("../materials/seeds.js");
      const { getPlaceServices } = await import("../services.js");
      const place = getPlaceServices();
      const seedParams =
        spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
      const { plantedSeedId, plantedThings } = await plantSeed({
        name: seed,
        atSpaceId: spaceId,
        identity,
        place,
        params: seedParams,
      });
      return {
        planted: true,
        plantedSeedId,
        name: seed,
        spaceId,
        plantedThings,
      };
    },
  });
}

// Namespaces NOT writable through set-qualities (each has its own verb).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

/**
 * Detect what the target argument is. Returns one of:
 *   "stance"   — resolved stance from the IBP wire (carries `.chain`)
 *   "being"    — Mongoose Being doc
 *   "matter"   — Mongoose Matter doc
 *   "space"    — Mongoose Space doc OR anything else (default; covers
 *                plain `{ _id }` shapes and raw string ids that the
 *                space materials helpers already handle)
 *
 * Detection priority:
 *   1. `.chain` is an array → resolver output (every resolved stance
 *      carries a top-down chain, including `[]` for bare place root)
 *   2. Mongoose `.constructor.modelName` → model-typed doc
 *   3. Default → "space"
 */
function detectTargetKind(target) {
  if (target && typeof target === "object" && Array.isArray(target.chain))
    return "stance";
  const modelName = target?.constructor?.modelName;
  if (modelName === "Being") return "being";
  if (modelName === "Matter") return "matter";
  return "space";
}

/**
 * Best-effort id extraction across the target shapes the dispatcher
 * accepts (Mongoose doc, plain `{_id}` shape, IBP wire `{spaceId}`
 * envelope, raw string id).
 */
function targetIdOf(target) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  if (target._id) return String(target._id);
  if (target.spaceId) return String(target.spaceId);
  if (target.id) return String(target.id);
  return null;
}

// ────────────────────────────────────────────────────────────────
// Stance-arrival handlers
// ────────────────────────────────────────────────────────────────
//
// When an op's target arrives from the IBP wire, it's a resolved stance
// (carries `.chain`, `.spaceId`, `.isPlaceRoot`, `.isHomeRoot`, etc.). The
// inline space/being/matter branches above handle Mongoose-doc shapes
// that internal callers pass; these helpers handle the wire shape.
//
// They do three things the inline paths don't:
//   1. Stance-specific gating (can't create-child at the place root;
//      home roots only by the home's being).
//   2. Tree-ownership + circuit-breaker check via resolveSpaceAccess.
//   3. Map seed-internal Error messages to IBP error codes so the
//      wire ack carries a precise code instead of generic INTERNAL.
//
// Note: the verb-level Stance Authorization gate in seed/ibp/verbs.js
// runs before these — they're the second layer covering tree-ownership
// (which authorize() doesn't know about) and shape-conversion (seed
// helper Errors → IbpError on the wire).

const KERNEL_ERROR_PATTERNS = {
  createChild: [
    [/cancelled by extension/i, IBP_ERR.FORBIDDEN],
    [/place seed spaces|reserved|invalid/i, IBP_ERR.INVALID_INPUT],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  ],
  rename: [
    [/place seed spaces/i, IBP_ERR.FORBIDDEN],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
    [/cannot|reserved|invalid|characters|empty/i, IBP_ERR.INVALID_INPUT],
  ],
  setMeta: [
    [/blocked/i, IBP_ERR.EXTENSION_BLOCKED],
    [/Namespace violation|reserved/i, IBP_ERR.FORBIDDEN],
    [
      /Invalid extension name|reserved key|nested too|too large/i,
      IBP_ERR.INVALID_INPUT,
    ],
    [/document size/i, IBP_ERR.DOCUMENT_SIZE_EXCEEDED],
  ],
};

async function createSpaceChild({ target, params, identity, kind }) {
  const beingId = identity?.beingId || null;
  const { name, type = null } = params || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }

  // Mongoose Space doc path: trust the caller, parent is the doc itself.
  if (kind !== "stance") {
    try {
      const newSpace = await createSpace({
        name,
        type,
        parentId: target?._id ? String(target._id) : null,
        beingId,
      });
      return shapeNewSpace(newSpace);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }

  // Stance-arrival path.
  if (target.isPlaceRoot) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "Cannot create-child at the place root. Create the tree under your home (~) instead.",
    );
  }
  if (target.isHomeRoot) {
    if (String(target.beingId) !== String(beingId)) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Cannot create a tree root in another being's home",
      );
    }
    try {
      const newSpace = await createSpace({ name, type, isRoot: true, beingId });
      return shapeNewSpace(newSpace);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }
  if (!target.spaceId) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Resolved position has no spaceId",
    );
  }
  try {
    const newSpace = await createSpace({
      name,
      type,
      parentId: target.spaceId,
      beingId,
    });
    return shapeNewSpace(newSpace);
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
  }
}

function shapeNewSpace(newSpace) {
  const spaceId = String(newSpace._id);
  return {
    spaceId,
    name: newSpace.name,
    position: `${getPlaceDomain()}/${spaceId}`,
    // _factTarget hints the dispatcher to name the new space (not the
    // parent the call addressed) as the substrate-event target.
    _factTarget: { kind: "space", id: spaceId },
  };
}

async function renameAtStance({ resolved, name, identity }) {
  const beingId = identity?.beingId || null;
  if (!resolved.spaceId) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Resolved address has no spaceId",
    );
  }
  const access = await resolveSpaceAccess(resolved.spaceId, beingId);
  if (!access?.ok || access.write !== true) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Not authorized to rename at this place",
    );
  }
  try {
    await editSpaceName({ spaceId: resolved.spaceId, newName: name, beingId });
    return { spaceId: String(resolved.spaceId), name };
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.rename);
  }
}

async function setMetaAtStance({ resolved, namespace, data, merge, identity }) {
  const beingId = identity?.beingId || null;
  if (!resolved.spaceId) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Resolved address has no spaceId",
    );
  }
  const access = await resolveSpaceAccess(resolved.spaceId, beingId);
  if (!access?.ok || access.write !== true) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Not authorized to write qualities at this place",
    );
  }
  const space = await Space.findById(resolved.spaceId);
  if (!space) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Space disappeared between resolve and write",
    );
  }
  try {
    if (merge === false) {
      await qualities.space.setQuality(space, namespace, data);
    } else {
      await qualities.space.mergeQuality(space, namespace, data);
    }
    return {
      written: true,
      spaceId: String(space._id),
      namespace,
      kind: "space",
    };
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.setMeta);
  }
}

// Auto-register on import so the registry is populated whether the caller
// is `place.do(...)` from extension code or the IBP wire dispatcher.
registerSeedOperations();
