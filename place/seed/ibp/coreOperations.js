// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Kernel DO operations. My native vocabulary.
//
// Every DO action that touches the substrate flows through the
// registry in operations.js. The actions extensions add are their
// own concerns; the actions the kernel needs to be itself live here.
// I register them at module load through the same surface extensions
// use — no privileged kernel path, no special treatment. The bare
// names are reserved for me because they describe the substrate
// shape; extensions get prefixes so every action's owner is
// structurally evident.
//
// What I ship:
//
//   create-child           (polymorphic over space/being/matter)
//   create-matter
//   set-name               (polymorphic)
//   set-type               (space)
//   set-parent             (space)
//   delete-space
//   set-meta               (polymorphic; namespace + data)
//   plant-seed             (extension scaffolding)
//   cascade                (fire an awareness signal at a space)
//   add-llm-connection     (being)
//   update-llm-connection  (being)
//   delete-llm-connection  (being)
//   assign-llm-slot        (polymorphic over being/space)
//   install-extension      (write files; reload-required)
//   uninstall-extension    (remove files; reload-required)
//   enable-extension       (toggle disabledExtensions list)
//   disable-extension      (toggle disabledExtensions list)
//   set-config             (place config key/value write)
//   delete-config          (place config key removal)
//
// create-being moved to BE on 2026-05-20 — minting identity is a BE
// concern, not a state mutation on space or matter.

import { registerOperation } from "./operations.js";
import {
  createSpace,
  editSpaceName,
  editSpaceType,
  deleteSpaceBranch,
  updateParentRelationship,
} from "../place/space/spaceManagement.js";
import { resolveSpaceAccess } from "../place/space/spaceFetch.js";
import { getPlaceDomain } from "../ibp/address.js";
import { IbpError, IBP_ERR, mapPatternsToIbpError } from "./protocol.js";
import Being from "../models/being.js";
import Matter from "../models/matter.js";
import Space from "../models/space.js";

import { qualities } from "../place/qualities.js";
let _registered = false;

/**
 * Register the kernel DO operations. Idempotent; calling twice is a no-op.
 * Invoked by services.js at module load so the registry is populated
 * before anyone dispatches.
 */
export function registerKernelOperations() {
  if (_registered) return;
  _registered = true;

  // create-child is polymorphic: the target's kind determines the kind
  // of the child created. Symmetric across all three substrate primitives.
  //
  //   Space    target → creates a child Space    (existing IBP path)
  //   Being    target → creates a child Being    (being-tree child;
  //                       generates username + password, places at
  //                       parent's home position unless overridden,
  //                       atomically links into parent.children)
  //   Matter   target → creates a child Matter   (matter-tree child;
  //                       inherits parent's spaceId, atomically links
  //                       into parent.children)
  //
  // For spawning Beings or Matter where the parent is a Space (root of
  // a being-tree / matter-tree at that space), use the dedicated
  // create-being / create-matter operations.
  registerOperation("create-child", {
    targets: ["space", "being", "matter"],
    ownerExtension: "kernel",
    didAction: "create",
    handler: async ({ target, params, identity }) => {
      const kind = detectTargetKind(target);
      if (kind === "being")
        return createBeingChild({ parentBeing: target, params, identity });
      if (kind === "matter")
        return createMatterChild({ parentMatter: target, params, identity });
      return createSpaceChild({ target, params, identity, kind });
    },
  });

  // create-matter: spawn new matter at a Space (root of the matter-tree
  // at that space, parentMatterId: null). For child matter under existing
  // matter, use create-child.
  registerOperation("create-matter", {
    targets: ["space"],
    ownerExtension: "kernel",
    didAction: "create",
    handler: async ({ target, params, identity }) => {
      const spaceId = targetIdOf(target);
      const matter = await Matter.create({
        spaceId,
        beingId: identity?.beingId || params.beingId || null,
        name: params.name || null,
        content: params.content ?? null,
        origin: params.origin || "ibp",
        parentMatterId: null,
        qualities: params.qualities
          ? new Map(Object.entries(params.qualities))
          : new Map(),
      });
      // _didTarget hints the dispatcher to name the new matter (not the
      // parent space the call addressed) as the substrate-event target.
      return {
        matter,
        matterId: String(matter._id),
        _didTarget: { kind: "matter", id: String(matter._id) },
      };
    },
  });

  // create-being moved to BE 2026-05-20. Creating a being is an
  // identity operation, not a state mutation on space or matter, so
  // it belongs on the BE verb. Callers now use:
  //
  //   await core.be("create-being", {
  //     name, password, operatingMode, role,
  //     homeSpace | homeParent, parentBeingId?,
  //   })
  //
  // The handler lives on the auth-being's `createBeing` method (see
  // seed/factory/roles/cherub.js). Per the philosophy notes: BE acts on
  // the being calling it, and identity creation is the BE side of the
  // grammar.

  // Field-update operations follow `set-<field>` pattern, parallel to
  // set-meta. Polymorphic across target kinds.
  //
  //   Space     target → mutates Space.name (existing rename path)
  //   Being    target → mutates Being.name (unique-indexed; throws
  //                       USERNAME_TAKEN on collision)
  //   Matter   target → mutates Matter.name (new field; nullable)
  registerOperation("set-name", {
    targets: ["space", "being", "matter"],
    ownerExtension: "kernel",
    didAction: "edit",
    handler: async ({ target, params, identity }) => {
      const { name } = params || {};
      if (!name || typeof name !== "string") {
        throw new Error("set-name: `name` is required");
      }
      const kind = detectTargetKind(target);

      if (kind === "being") {
        // Uniqueness pre-check + update. Mongoose unique index throws
        // on collision; surface a friendly error.
        const existing = await Being.findOne({ name: name }).select("_id");
        if (existing && String(existing._id) !== String(target._id)) {
          throw new Error(`set-name: username "${name}" already taken`);
        }
        await Being.updateOne({ _id: target._id }, { $set: { name: name } });
        return { beingId: String(target._id), name };
      }

      if (kind === "matter") {
        await Matter.updateOne({ _id: target._id }, { $set: { name } });
        return { matterId: String(target._id), name };
      }

      if (kind === "stance")
        return renameAtStance({ resolved: target, name, identity });

      // Mongoose Space doc path: call the seed primitive directly.
      await editSpaceName({
        spaceId: String(target._id),
        newName: name,
        beingId: identity?.beingId || null,
      });
      return { spaceId: String(target._id), name };
    },
  });

  // set-status retired from seed 2026-05-18. Status is domain-specific
  // and lives in extension qualities; extensions register their own
  // <ext>:set-<field> ops for state transitions. See
  // [[project_substrate_as_universal_workspace]] for the framing.

  // set-type: change a Space's type field. Used by editType HTTP route
  // and any caller that needs to mutate the type taxonomy at a space.
  registerOperation("set-type", {
    targets: ["space"],
    ownerExtension: "kernel",
    didAction: "edit",
    handler: async ({ target, params, identity }) => {
      const { type } = params || {};
      if (!type || typeof type !== "string") {
        throw new Error("set-type: `type` is required");
      }
      const spaceId = targetIdOf(target);
      await editSpaceType({
        spaceId,
        newType: type,
        beingId: identity?.beingId || null,
      });
      return { spaceId, type };
    },
  });

  // delete-space: remove a space (and its subtree) from the tree.
  // Returns { deletedSpaceId }. The actual seed primitive handles
  // cascades, hooks, and rollback semantics; this op is the public
  // verb surface.
  registerOperation("delete-space", {
    targets: ["space"],
    ownerExtension: "kernel",
    didAction: "remove",
    handler: async ({ target, params: _params, identity }) => {
      const spaceId = targetIdOf(target);
      const deleted = await deleteSpaceBranch(
        spaceId,
        identity?.beingId || null,
      );
      return { deletedSpaceId: String(deleted?._id || spaceId) };
    },
  });

  // delete-matter: remove matter (and its child matter via the seed
  // primitive's cascade). The target is the Matter doc (or a `{ _id }`
  // envelope). The kernel primitive enforces the ownership gate —
  // caller must be the matter's author or the containing tree's
  // rootOwner — so passing internal:true is only safe for kernel-
  // internal callers acting on substrate they manage.
  registerOperation("delete-matter", {
    targets: ["matter"],
    ownerExtension: "kernel",
    didAction: "remove",
    handler: async ({ target, params: _params, identity, summonCtx }) => {
      const matterId = String(target?._id || target?.matterId || target);
      if (!matterId) throw new Error("delete-matter: matterId required");
      const { deleteMatterAndFile } = await import("../place/matter/matters.js");
      const beingId =
        identity?.beingId ||
        (await Matter.findById(matterId).select("beingId").lean())?.beingId;
      await deleteMatterAndFile({
        matterId,
        beingId: String(beingId || ""),
        summonId: summonCtx?.summonId || null,
        sessionId: summonCtx?.sessionId || null,
      });
      return { removed: true, matterId };
    },
  });

  // set-parent: reparent a space. The target IS the space being moved;
  // params.parentId names the new parent.
  registerOperation("set-parent", {
    targets: ["space"],
    ownerExtension: "kernel",
    didAction: "move",
    handler: async ({ target, params, identity }) => {
      const { parentId } = params || {};
      if (!parentId || typeof parentId !== "string") {
        throw new Error("set-parent: `parentId` is required");
      }
      const spaceId = targetIdOf(target);
      const result = await updateParentRelationship(
        spaceId,
        parentId,
        identity?.beingId || null,
      );
      return result || { spaceId, parentId };
    },
  });

  // Unified set-meta. Accepts a Mongoose Space / Being / Matter doc,
  // or (from the IBP wire path) a resolved stance that carries `.chain`
  // and `.spaceId`. Detects which and routes to the appropriate seed
  // primitive.
  //
  // The merge flag is the safe default (true): partial writes don't
  // wipe sibling keys. merge:false replaces the whole namespace; that
  // is the explicit destructive opt-in.
  //
  // Reserved namespaces (e.g. "inbox") rejected for all target kinds.
  registerOperation("set-meta", {
    targets: ["space", "being", "matter"],
    ownerExtension: "kernel",
    didAction: "edit",
    handler: async ({ target, params, identity }) => {
      const { namespace, data, merge = true } = params || {};
      if (!namespace || typeof namespace !== "string") {
        throw new Error("set-meta: `namespace` is required");
      }
      if (RESERVED_SET_META_NS.has(namespace)) {
        throw new Error(
          `set-meta: namespace "${namespace}" is not writable through set-meta`,
        );
      }
      if (data === undefined || data === null || typeof data !== "object") {
        throw new Error("set-meta: `data` must be an object");
      }

      const kind = detectTargetKind(target);

      if (kind === "being") {
        const op =
          merge !== false
            ? qualities.being.mergeQuality
            : qualities.being.setQuality;
        await op(target, namespace, data);
        return {
          written: true,
          beingId: String(target._id),
          namespace,
          kind: "being",
        };
      }
      if (kind === "matter") {
        const op =
          merge !== false
            ? qualities.matter.mergeQuality
            : qualities.matter.setQuality;
        await op(target, namespace, data);
        return {
          written: true,
          matterId: String(target._id),
          namespace,
          kind: "matter",
        };
      }
      if (kind === "stance")
        return setMetaAtStance({
          resolved: target,
          namespace,
          data,
          merge,
          identity,
        });
      // kind === "space": Mongoose Space doc passed directly (extension path).
      const op =
        merge !== false
          ? qualities.space.mergeQuality
          : qualities.space.setQuality;
      await op(target, namespace, data);
      return {
        written: true,
        spaceId: String(target._id),
        namespace,
        kind: "space",
      };
    },
  });

  // plant-seed: invoke a registered seed recipe at the target space.
  // The recipe scaffolds the structure (Ruler beings, sub-domain
  // spaces, starter matter, qualities) on the target. See
  // seed/place/seeds.js.
  //
  // params:
  //   name   — required. The seed's registered name.
  //   params — optional. Plant-time configuration the operator passes
  //            to the seed (free-shape object: projectPath for a code
  //            workspace, theme for a UI extension, etc.). The seed
  //            defines its own schema in prose; the kernel just
  //            threads the object through to the scaffold ctx.
  registerOperation("plant-seed", {
    targets: ["space"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { name } = params || {};
      if (!name || typeof name !== "string") {
        throw new Error(
          "plant-seed: `name` is required (the seed's registered name)",
        );
      }
      const spaceId = targetIdOf(target);
      if (!spaceId)
        throw new Error("plant-seed: target must resolve to a space id");
      const { plantSeed } = await import("../place/seeds.js");
      const { getCoreServices } = await import("../services.js");
      const core = getCoreServices();
      const seedParams =
        params?.params &&
        typeof params.params === "object" &&
        !Array.isArray(params.params)
          ? params.params
          : {};
      const { plantedSeedId, plantedThings } = await plantSeed({
        name,
        atSpaceId: spaceId,
        identity,
        core,
        params: seedParams,
      });
      return { planted: true, plantedSeedId, name, spaceId, plantedThings };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Cascade — fire an awareness signal from a space.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: the space the signal arrives at. Payload carries the signal
  // content + source. See [[project_cascade]] for the architecture and
  // seed/place/space/cascade.js for the delivery semantics.
  registerOperation("cascade", {
    targets: ["space"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity: _identity }) => {
      const spaceId = targetIdOf(target);
      const { payload = {}, source, signalId, depth } = params || {};
      const { v4: uuidv4 } = await import("uuid");
      const { deliverCascade } = await import("../place/space/cascade.js");
      const sid = signalId || uuidv4();
      const result = await deliverCascade({
        spaceId,
        signalId: sid,
        payload,
        source: source || spaceId,
        depth: depth || 0,
      });
      return { signalId: sid, result };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // LLM connections — per-Being LLM provider credentials.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: the Being that owns the connection. Connection records are
  // stored in the LlmConnection collection, indexed by beingId. The ops
  // wrap the seed/factory/beingAssignment/llm/connections.js helpers; the IBP grammar gives
  // them a single dispatch surface.

  registerOperation("add-llm-connection", {
    targets: ["being"],
    ownerExtension: "kernel",
    handler: async ({ target, params }) => {
      const { name, baseUrl, apiKey, model } = params || {};
      if (!name || !baseUrl || !model) {
        throw new Error(
          "add-llm-connection: `name`, `baseUrl`, and `model` are required",
        );
      }
      const { addLlmConnection, assignConnection } =
        await import("../factory/beingAssignment/llm/connections.js");
      const beingId = String(target._id);
      const connection = await addLlmConnection(beingId, {
        name,
        baseUrl,
        apiKey: apiKey || "none",
        model,
      });
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
    ownerExtension: "kernel",
    handler: async ({ target, params }) => {
      const { connectionId, name, baseUrl, apiKey, model } = params || {};
      if (!connectionId)
        throw new Error("update-llm-connection: `connectionId` is required");
      if (!baseUrl || !model) {
        throw new Error(
          "update-llm-connection: `baseUrl` and `model` are required",
        );
      }
      const { updateLlmConnection } =
        await import("../factory/beingAssignment/llm/connections.js");
      const connection = await updateLlmConnection(
        String(target._id),
        connectionId,
        { name, baseUrl, apiKey, model },
      );
      return { connection };
    },
  });

  registerOperation("delete-llm-connection", {
    targets: ["being"],
    ownerExtension: "kernel",
    handler: async ({ target, params }) => {
      const { connectionId } = params || {};
      if (!connectionId)
        throw new Error("delete-llm-connection: `connectionId` is required");
      const { deleteLlmConnection } =
        await import("../factory/beingAssignment/llm/connections.js");
      await deleteLlmConnection(String(target._id), connectionId);
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
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { slot, connectionId } = params || {};
      if (!slot) throw new Error("assign-llm-slot: `slot` is required");
      const kind = detectTargetKind(target);
      const { assignConnection, assignSpaceConnection } =
        await import("../factory/beingAssignment/llm/connections.js");
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
  // writes go through these DO ops which wrap the kernel's
  // setPlaceConfigValue helper. The helper handles cache invalidation,
  // validation, and PROTECTED_KEYS gating.

  registerOperation("set-config", {
    targets: ["space"],
    ownerExtension: "kernel",
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
    ownerExtension: "kernel",
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
}

// Namespaces NOT writable through set-meta (each has its own verb).
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
 *                space primitives already handle)
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
//   3. Map kernel-internal Error messages to IBP error codes so the
//      wire ack carries a precise code instead of generic INTERNAL.
//
// Note: the verb-level Stance Authorization gate in seed/ibp/verbs.js
// runs before these — they're the second layer covering tree-ownership
// (which authorize() doesn't know about) and shape-conversion (kernel
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
    // _didTarget hints the dispatcher to name the new space (not the
    // parent the call addressed) as the substrate-event target.
    _didTarget: { kind: "space", id: spaceId },
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
// is `core.do(...)` from extension code or the IBP wire dispatcher.
registerKernelOperations();
