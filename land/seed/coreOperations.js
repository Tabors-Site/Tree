// TreeOS Seed . AGPL-3.0 . https://treeos.ai
//
// Kernel DO operations.
//
// The four existing IBP actions (create-child, rename, change-status,
// set-meta) register through the operations registry on module load.
// Same surface extensions use; no special treatment for the kernel ones.
//
// Phase 2 of [[project_seed_four_verbs_only]]. The action handler
// implementations stay in land/ibp/actions/*.js for now; this file is
// the registration glue + shape adapter between the new dispatcher
// signature `({ target, params, identity, summonCtx })` and the
// existing action signature `(ctx = { beingId, resolved, payload })`.
//
// When Phase 4 migrates extensions to the verb surface, the existing
// action signature retires and these adapters collapse away.

import { registerOperation } from "./operations.js";
import { createChild as ibpNodeCreateChild } from "../ibp/actions/create-child.js";
import { rename       as ibpNodeRename }     from "../ibp/actions/rename.js";
import { setMeta      as ibpNodeSetMeta }    from "../ibp/actions/set-meta.js";
import { setExtMeta, mergeExtMeta }            from "./tree/extensionMetadata.js";
import { setBeingMeta, mergeBeingMeta }        from "./tree/beingMetadata.js";
import { setArtifactMeta, mergeArtifactMeta }  from "./tree/artifactMetadata.js";
import { editNodeName }                        from "./tree/treeManagement.js";
import Being    from "./models/being.js";
import Artifact from "./models/artifact.js";

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
  //   Node     target → creates a child Node     (existing IBP path)
  //   Being    target → creates a child Being    (being-tree child;
  //                       generates username + password, places at
  //                       parent's home position unless overridden,
  //                       atomically links into parent.children)
  //   Artifact target → creates a child Artifact (artifact-tree child;
  //                       inherits parent's nodeId, atomically links
  //                       into parent.children)
  //
  // For spawning Beings or Artifacts where the parent is a Node (root of
  // a being-tree / artifact-tree at that node), use the dedicated
  // create-being / create-artifact operations.
  registerOperation("create-child", {
    targets: ["node", "being", "artifact"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const kind = detectTargetKind(target);
      if (kind === "being")    return createBeingChild({ parentBeing: target, params, identity });
      if (kind === "artifact") return createArtifactChild({ parentArtifact: target, params, identity });
      // Node or resolved-stance path: existing IBP create-child handler.
      return ibpNodeCreateChild({
        beingId:  identity?.beingId || null,
        resolved: target,
        payload:  params,
      });
    },
  });

  // create-artifact: spawn a new artifact at a Node (root of the
  // artifact-tree at that node, parentArtifactId: null). For child
  // artifacts under an existing artifact, use create-child.
  registerOperation("create-artifact", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const nodeId = targetIdOf(target);
      const artifact = await Artifact.create({
        nodeId,
        beingId: identity?.beingId || params.beingId || null,
        name:    params.name || null,
        content: params.content ?? null,
        origin:  params.origin || "ibp",
        parentArtifactId: null,
        metadata: params.metadata
          ? new Map(Object.entries(params.metadata))
          : new Map(),
      });
      return artifact;
    },
  });

  // create-being: spawn a top-level being at a Node (parentBeingId: null).
  // Most beings should be created via create-child off an existing being
  // (humans → Rulers → inner beings). This op covers root cases (the
  // user-being itself is created by auth, not this op; root Rulers in
  // some boot paths use this).
  registerOperation("create-being", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity: _identity }) => {
      const nodeId = targetIdOf(target);
      const { createBeingWithHome } = await import("./auth.js");
      const { being } = await createBeingWithHome({
        operatingMode: params.operatingMode || "ai",
        role:          params.role || null,
        homeNodeId:    nodeId,
        parentBeingId: null,
        username:      params.username,
        password:      params.password,
      });
      return being;
    },
  });

  // Field-update operations follow `set-<field>` pattern, parallel to
  // set-meta. Polymorphic across target kinds.
  //
  //   Node     target → mutates Node.name (existing rename path)
  //   Being    target → mutates Being.username (unique-indexed; throws
  //                       USERNAME_TAKEN on collision)
  //   Artifact target → mutates Artifact.name (new field; nullable)
  registerOperation("set-name", {
    targets: ["node", "being", "artifact"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { name } = params || {};
      if (!name || typeof name !== "string") {
        throw new Error("set-name: `name` is required");
      }
      const kind = detectTargetKind(target);

      if (kind === "being") {
        // Uniqueness pre-check + update. Mongoose unique index throws
        // on collision; surface a friendly error.
        const existing = await Being.findOne({ username: name }).select("_id");
        if (existing && String(existing._id) !== String(target._id)) {
          throw new Error(`set-name: username "${name}" already taken`);
        }
        await Being.updateOne({ _id: target._id }, { $set: { username: name } });
        return { beingId: String(target._id), name };
      }

      if (kind === "artifact") {
        await Artifact.updateOne({ _id: target._id }, { $set: { name } });
        return { artifactId: String(target._id), name };
      }

      if (kind === "stance") {
        // IBP wire path: defer to existing rename handler.
        return ibpNodeRename({
          beingId:  identity?.beingId || null,
          resolved: target,
          payload:  params,
        });
      }

      // Mongoose Node doc path: call the seed primitive directly.
      await editNodeName({
        nodeId: String(target._id),
        newName: name,
        beingId: identity?.beingId || null,
      });
      return { nodeId: String(target._id), name };
    },
  });

  // set-status retired from seed 2026-05-18. Status is domain-specific
  // and lives in extension metadata; extensions register their own
  // <ext>:set-<field> ops for state transitions. See
  // [[project_substrate_as_universal_workspace]] for the framing.

  // Unified set-meta. Accepts a Mongoose Node / Being / Artifact doc,
  // or (from the IBP wire path) a resolved stance that carries
  // `.zone === "tree"` + `.nodeId`. Detects which and routes to the
  // appropriate seed primitive.
  //
  // The merge flag is the safe default (true): partial writes don't
  // wipe sibling keys. merge:false replaces the whole namespace; that
  // is the explicit destructive opt-in.
  //
  // Reserved namespaces (e.g. "inbox") rejected for all target kinds.
  registerOperation("set-meta", {
    targets: ["node", "being", "artifact"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { namespace, data, merge = true } = params || {};
      if (!namespace || typeof namespace !== "string") {
        throw new Error("set-meta: `namespace` is required");
      }
      if (RESERVED_SET_META_NS.has(namespace)) {
        throw new Error(`set-meta: namespace "${namespace}" is not writable through set-meta`);
      }
      if (data === undefined || data === null || typeof data !== "object") {
        throw new Error("set-meta: `data` must be an object");
      }

      const kind = detectTargetKind(target);

      if (kind === "being") {
        const op = merge !== false ? mergeBeingMeta : setBeingMeta;
        await op(target, namespace, data);
        return { written: true, beingId: String(target._id), namespace, kind: "being" };
      }
      if (kind === "artifact") {
        const op = merge !== false ? mergeArtifactMeta : setArtifactMeta;
        await op(target, namespace, data);
        return { written: true, artifactId: String(target._id), namespace, kind: "artifact" };
      }
      if (kind === "stance") {
        // IBP wire path: target is a resolved stance with zone + nodeId.
        // Defer to the existing IBP set-meta action which does zone
        // check + resolveTreeAccess + load-by-id + write.
        return ibpNodeSetMeta({
          beingId:  identity?.beingId || null,
          resolved: target,
          payload:  params,
        });
      }
      // kind === "node": Mongoose Node doc passed directly (extension path).
      const op = merge !== false ? mergeExtMeta : setExtMeta;
      await op(target, namespace, data);
      return { written: true, nodeId: String(target._id), namespace, kind: "node" };
    },
  });
}

// Namespaces NOT writable through set-meta (each has its own verb).
const RESERVED_SET_META_NS = new Set([
  "inbox", // per-being inbox; written through SUMMON
]);

/**
 * Detect what the target argument is. Returns one of:
 *   "stance"   — resolved stance from the IBP wire (has `.zone`)
 *   "being"    — Mongoose Being doc
 *   "artifact" — Mongoose Artifact doc
 *   "node"     — Mongoose Node doc OR anything else (default)
 *
 * Detection priority:
 *   1. `.zone` field present → resolved stance (IBP wire shape)
 *   2. Mongoose `.constructor.modelName` → model-typed doc
 *   3. Default → "node" (covers plain `{ _id }` shapes and string ids,
 *      which the node primitives already handle)
 */
function detectTargetKind(target) {
  if (target && typeof target === "object" && target.zone !== undefined) return "stance";
  const modelName = target?.constructor?.modelName;
  if (modelName === "Being")    return "being";
  if (modelName === "Artifact") return "artifact";
  return "node";
}

// Auto-register on import so the registry is populated whether the caller
// is `core.do(...)` from extension code or the IBP wire dispatcher.
registerKernelOperations();
