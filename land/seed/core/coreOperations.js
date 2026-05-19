// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Kernel DO operations.
//
// Kernel-shipped operations register through the operations registry
// on module load. Same surface extensions use; no special treatment.
//
// Current set:
//   create-child            (polymorphic over node/being/artifact)
//   create-artifact, create-being
//   set-name                (polymorphic over node/being/artifact)
//   set-type                (node)
//   set-parent              (node)
//   delete-node             (node)
//   set-meta                (polymorphic; namespace + data)
//   plant-seed              (extension scaffolding)
//   cascade                 (fire an awareness signal at a node)
//   add-llm-connection      (being)
//   update-llm-connection   (being)
//   delete-llm-connection   (being)
//   assign-llm-slot         (polymorphic over being/node)
//   install-extension       (write files; reload-required)
//   uninstall-extension     (remove files; reload-required)
//   enable-extension        (toggle disabledExtensions list)
//   disable-extension       (toggle disabledExtensions list)
//   set-config              (land config key/value write)
//   delete-config           (land config key removal)
//
// See [[project_seed_four_verbs_only]], [[project_ibp_universal_grammar]],
// [[project_everything_is_substrate]].

import { registerOperation } from "./operations.js";
import { setExtMeta, mergeExtMeta }            from "../tree/extensionMetadata.js";
import { setBeingMeta, mergeBeingMeta }        from "../tree/beingMetadata.js";
import { setArtifactMeta, mergeArtifactMeta }  from "../tree/artifactMetadata.js";
import { createNode, editNodeName, editNodeType, deleteNodeBranch, updateParentRelationship } from "../tree/treeManagement.js";
import { resolveTreeAccess } from "../tree/treeAccess.js";
import { getLandDomain } from "../addressing/address.js";
import { IbpError, IBP_ERR, mapPatternsToIbpError } from "./errors.js";
import Being    from "../models/being.js";
import Artifact from "../models/artifact.js";
import Node     from "../models/node.js";

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
      return createNodeChild({ target, params, identity, kind });
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
      const { createBeingWithHome } = await import("./identity.js");
      const { being } = await createBeingWithHome({
        operatingMode: params.operatingMode || "ai",
        role:          params.role || null,
        homeNodeId:    nodeId,
        parentBeingId: null,
        name:          params.name,
        password:      params.password,
      });
      return being;
    },
  });

  // Field-update operations follow `set-<field>` pattern, parallel to
  // set-meta. Polymorphic across target kinds.
  //
  //   Node     target → mutates Node.name (existing rename path)
  //   Being    target → mutates Being.name (unique-indexed; throws
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
        const existing = await Being.findOne({ name: name }).select("_id");
        if (existing && String(existing._id) !== String(target._id)) {
          throw new Error(`set-name: username "${name}" already taken`);
        }
        await Being.updateOne({ _id: target._id }, { $set: { name: name } });
        return { beingId: String(target._id), name };
      }

      if (kind === "artifact") {
        await Artifact.updateOne({ _id: target._id }, { $set: { name } });
        return { artifactId: String(target._id), name };
      }

      if (kind === "stance") return renameAtStance({ resolved: target, name, identity });

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

  // set-type: change a Node's type field. Used by editType HTTP route
  // and any caller that needs to mutate the type taxonomy at a node.
  registerOperation("set-type", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { type } = params || {};
      if (!type || typeof type !== "string") {
        throw new Error("set-type: `type` is required");
      }
      const nodeId = targetIdOf(target);
      await editNodeType({
        nodeId,
        newType: type,
        beingId: identity?.beingId || null,
      });
      return { nodeId, type };
    },
  });

  // delete-node: remove a node (and its subtree) from the tree.
  // Returns { deletedNodeId }. The actual seed primitive handles
  // cascades, hooks, and rollback semantics; this op is the public
  // verb surface.
  registerOperation("delete-node", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params: _params, identity }) => {
      const nodeId = targetIdOf(target);
      const deleted = await deleteNodeBranch(nodeId, identity?.beingId || null);
      return { deletedNodeId: String(deleted?._id || nodeId) };
    },
  });

  // set-parent: reparent a node. The target IS the node being moved;
  // params.parentId names the new parent.
  registerOperation("set-parent", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { parentId } = params || {};
      if (!parentId || typeof parentId !== "string") {
        throw new Error("set-parent: `parentId` is required");
      }
      const nodeId = targetIdOf(target);
      const result = await updateParentRelationship(
        nodeId,
        parentId,
        identity?.beingId || null,
      );
      return result || { nodeId, parentId };
    },
  });

  // Unified set-meta. Accepts a Mongoose Node / Being / Artifact doc,
  // or (from the IBP wire path) a resolved stance that carries `.chain`
  // and `.nodeId`. Detects which and routes to the appropriate seed
  // primitive.
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
      if (kind === "stance") return setMetaAtStance({ resolved: target, namespace, data, merge, identity });
      // kind === "node": Mongoose Node doc passed directly (extension path).
      const op = merge !== false ? mergeExtMeta : setExtMeta;
      await op(target, namespace, data);
      return { written: true, nodeId: String(target._id), namespace, kind: "node" };
    },
  });

  // plant-seed: invoke a registered seed recipe at the target node. The
  // recipe scaffolds the structure (Ruler beings, sub-domain nodes,
  // starter artifacts, metadata) on the target. See seed/seeds.js and
  // memory `extension-seeds`. params: { name } — the seed to plant.
  registerOperation("plant-seed", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { name } = params || {};
      if (!name || typeof name !== "string") {
        throw new Error("plant-seed: `name` is required (the seed's registered name)");
      }
      const nodeId = targetIdOf(target);
      if (!nodeId) throw new Error("plant-seed: target must resolve to a node id");
      const { plantSeed } = await import("./seeds.js");
      const { getCoreServices } = await import("./services.js");
      const core = getCoreServices();
      const { plantedSeedId, plantedThings } = await plantSeed({
        name,
        atNodeId: nodeId,
        identity,
        core,
      });
      return { planted: true, plantedSeedId, name, nodeId, plantedThings };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Cascade — fire an awareness signal from a node.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: the node the signal arrives at. Payload carries the signal
  // content + source. See [[project_cascade]] for the architecture and
  // seed/tree/cascade.js for the delivery semantics.
  registerOperation("cascade", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity: _identity }) => {
      const nodeId = targetIdOf(target);
      const { payload = {}, source, signalId, depth } = params || {};
      const { v4: uuidv4 } = await import("uuid");
      const { deliverCascade } = await import("../tree/cascade.js");
      const sid = signalId || uuidv4();
      const result = await deliverCascade({
        nodeId,
        signalId: sid,
        payload,
        source: source || nodeId,
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
  // wrap the seed/llm/connections.js helpers; the IBP grammar gives
  // them a single dispatch surface.

  registerOperation("add-llm-connection", {
    targets: ["being"],
    ownerExtension: "kernel",
    handler: async ({ target, params }) => {
      const { name, baseUrl, apiKey, model } = params || {};
      if (!name || !baseUrl || !model) {
        throw new Error("add-llm-connection: `name`, `baseUrl`, and `model` are required");
      }
      const { addLlmConnection, assignConnection } = await import("../llm/connections.js");
      const beingId = String(target._id);
      const connection = await addLlmConnection(beingId, {
        name, baseUrl, apiKey: apiKey || "none", model,
      });
      // If this is the Being's first connection, auto-assign it to the
      // default `main` slot so subsequent runChat calls find an LLM.
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
      if (!connectionId) throw new Error("update-llm-connection: `connectionId` is required");
      if (!baseUrl || !model) {
        throw new Error("update-llm-connection: `baseUrl` and `model` are required");
      }
      const { updateLlmConnection } = await import("../llm/connections.js");
      const connection = await updateLlmConnection(
        String(target._id), connectionId,
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
      if (!connectionId) throw new Error("delete-llm-connection: `connectionId` is required");
      const { deleteLlmConnection } = await import("../llm/connections.js");
      await deleteLlmConnection(String(target._id), connectionId);
      return { removed: true, connectionId };
    },
  });

  // Bind an LLM slot to a connection (or unbind by passing null).
  // Polymorphic across Being and Node targets — the resolution chain
  // walks both, so slot assignment lives at both:
  //
  //   Being target → Being.llmDefault (slot="main") or
  //                  Being.metadata.userLlm.slots.<slot>
  //   Node  target → Node.llmDefault  (slot="main") or
  //                  Node.metadata.llm.slots.<slot>
  registerOperation("assign-llm-slot", {
    targets: ["being", "node"],
    ownerExtension: "kernel",
    handler: async ({ target, params, identity }) => {
      const { slot, connectionId } = params || {};
      if (!slot) throw new Error("assign-llm-slot: `slot` is required");
      const kind = detectTargetKind(target);
      const { assignConnection, assignNodeConnection } = await import("../llm/connections.js");
      if (kind === "being") {
        return assignConnection(String(target._id), slot, connectionId || null);
      }
      const nodeId = targetIdOf(target);
      if (!nodeId) throw new Error("assign-llm-slot: target must resolve to a node id");
      return assignNodeConnection(nodeId, slot, connectionId || null, {
        ownerBeingId: identity?.beingId || null,
      });
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Extension management — per [[project_everything_is_substrate]],
  // installed-state is substrate. These ops drive the loader.
  // ────────────────────────────────────────────────────────────────
  //
  // Target: any node on this land — typically the land root. The
  // extension's installed-state isn't bound to a particular node; the
  // target lets stance authorization gate who can install.

  const EXT_NAME_RE = /^[a-z0-9-]+$/i;

  // Install: write extension files to disk. Loader picks them up on
  // restart. Payload: { name, version?, manifest?, files: [{path,content}] }
  registerOperation("install-extension", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { name, version, manifest, files } = params || {};
      if (!name || !Array.isArray(files) || files.length === 0) {
        throw new Error("install-extension: `name` and `files` are required");
      }
      if (!EXT_NAME_RE.test(name)) {
        throw new Error("install-extension: invalid extension name");
      }
      const { installExtensionFiles } = await import("../../extensions/loader.js");
      const result = await installExtensionFiles(name, files);
      return {
        installed: true,
        name,
        version: version || manifest?.version || "unknown",
        filesWritten: result.filesWritten,
        note: "Restart the land to load the extension.",
      };
    },
  });

  // Uninstall: remove an extension directory. Loader unmounts on next boot.
  registerOperation("uninstall-extension", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { name } = params || {};
      if (!name || !EXT_NAME_RE.test(name)) {
        throw new Error("uninstall-extension: invalid extension name");
      }
      const fs = await import("fs");
      const path = await import("path");
      const { fileURLToPath } = await import("url");
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const extDir = path.join(__dirname, "../extensions", name);
      if (!fs.existsSync(extDir)) {
        throw new Error(`uninstall-extension: extension "${name}" not found on disk`);
      }
      fs.rmSync(extDir, { recursive: true, force: true });
      return { uninstalled: true, name, note: "Restart the land to unload." };
    },
  });

  // Enable / disable an extension by toggling its membership in the
  // land's `disabledExtensions` config list. Loader honors the list
  // on next boot.
  registerOperation("disable-extension", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { name } = params || {};
      if (!name || !EXT_NAME_RE.test(name)) {
        throw new Error("disable-extension: invalid extension name");
      }
      const { getLandConfigValue, setLandConfigValue } = await import("../landConfig.js");
      const current = getLandConfigValue("disabledExtensions") || [];
      if (!current.includes(name)) {
        current.push(name);
        const { syncDisabledFile } = await import("../../extensions/loader.js");
        syncDisabledFile(current);
        await setLandConfigValue("disabledExtensions", current);
      }
      return { disabled: true, name, disabledExtensions: current };
    },
  });

  registerOperation("enable-extension", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { name } = params || {};
      if (!name || !EXT_NAME_RE.test(name)) {
        throw new Error("enable-extension: invalid extension name");
      }
      const { getLandConfigValue, setLandConfigValue } = await import("../landConfig.js");
      const current = getLandConfigValue("disabledExtensions") || [];
      const updated = current.filter((n) => n !== name);
      await setLandConfigValue("disabledExtensions", updated);
      const { syncDisabledFile } = await import("../../extensions/loader.js");
      syncDisabledFile(updated);
      return { enabled: true, name, disabledExtensions: updated };
    },
  });

  // ────────────────────────────────────────────────────────────────
  // Land config — flat key/value store on the .config system node.
  // ────────────────────────────────────────────────────────────────
  //
  // Land config is one of the meta-positions ([[project_meta_positions]]):
  // `<land>/.config` resolves to the SYSTEM_ROLE.CONFIG node. Reads go
  // through `ibp:see` on that address (returns the cached config snapshot);
  // writes go through these DO ops which wrap the kernel's
  // setLandConfigValue helper. The helper handles cache invalidation,
  // validation, and PROTECTED_KEYS gating.

  registerOperation("set-config", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { key, value } = params || {};
      if (!key || typeof key !== "string") {
        throw new Error("set-config: `key` is required");
      }
      if (value === undefined) {
        throw new Error("set-config: `value` is required (use delete-config to remove)");
      }
      const { setLandConfigValue } = await import("../landConfig.js");
      await setLandConfigValue(key, value);
      return { key, value };
    },
  });

  registerOperation("delete-config", {
    targets: ["node"],
    ownerExtension: "kernel",
    handler: async ({ params }) => {
      const { key } = params || {};
      if (!key || typeof key !== "string") {
        throw new Error("delete-config: `key` is required");
      }
      const { deleteLandConfigValue } = await import("../landConfig.js");
      await deleteLandConfigValue(key);
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
 *   "artifact" — Mongoose Artifact doc
 *   "node"     — Mongoose Node doc OR anything else (default; covers
 *                plain `{ _id }` shapes and raw string ids that the
 *                node primitives already handle)
 *
 * Detection priority:
 *   1. `.chain` is an array → resolver output (every resolved stance
 *      carries a top-down chain, including `[]` for bare land root)
 *   2. Mongoose `.constructor.modelName` → model-typed doc
 *   3. Default → "node"
 */
function detectTargetKind(target) {
  if (target && typeof target === "object" && Array.isArray(target.chain)) return "stance";
  const modelName = target?.constructor?.modelName;
  if (modelName === "Being")    return "being";
  if (modelName === "Artifact") return "artifact";
  return "node";
}

/**
 * Best-effort id extraction across the target shapes the dispatcher
 * accepts (Mongoose doc, plain `{_id}` shape, IBP wire `{nodeId}`
 * envelope, raw string id).
 */
function targetIdOf(target) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  if (target._id) return String(target._id);
  if (target.nodeId) return String(target.nodeId);
  if (target.id) return String(target.id);
  return null;
}

// ────────────────────────────────────────────────────────────────
// Stance-arrival handlers
// ────────────────────────────────────────────────────────────────
//
// When an op's target arrives from the IBP wire, it's a resolved stance
// (carries `.chain`, `.nodeId`, `.isLandRoot`, `.isHomeRoot`, etc.). The
// inline node/being/artifact branches above handle Mongoose-doc shapes
// that internal callers pass; these helpers handle the wire shape.
//
// They do three things the inline paths don't:
//   1. Stance-specific gating (can't create-child at the land root;
//      home roots only by the home's being).
//   2. Tree-ownership + circuit-breaker check via resolveTreeAccess.
//   3. Map kernel-internal Error messages to IBP error codes so the
//      wire ack carries a precise code instead of generic INTERNAL.
//
// Note: the verb-level Stance Authorization gate in seed/core/verbs.js
// runs before these — they're the second layer covering tree-ownership
// (which authorize() doesn't know about) and shape-conversion (kernel
// helper Errors → IbpError on the wire).

const KERNEL_ERROR_PATTERNS = {
  createChild: [
    [/cancelled by extension/i,        IBP_ERR.FORBIDDEN],
    [/system nodes|reserved|invalid/i, IBP_ERR.INVALID_INPUT],
    [/not found/i,                     IBP_ERR.NODE_NOT_FOUND],
  ],
  rename: [
    [/system nodes/i,                              IBP_ERR.FORBIDDEN],
    [/not found/i,                                 IBP_ERR.NODE_NOT_FOUND],
    [/cannot|reserved|invalid|characters|empty/i,  IBP_ERR.INVALID_INPUT],
  ],
  setMeta: [
    [/blocked/i,                                                  IBP_ERR.EXTENSION_BLOCKED],
    [/Namespace violation|reserved/i,                             IBP_ERR.FORBIDDEN],
    [/Invalid extension name|reserved key|nested too|too large/i, IBP_ERR.INVALID_INPUT],
    [/document size/i,                                            IBP_ERR.DOCUMENT_SIZE_EXCEEDED],
  ],
};

async function createNodeChild({ target, params, identity, kind }) {
  const beingId = identity?.beingId || null;
  const { name, type = null } = params || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }

  // Mongoose Node doc path: trust the caller, parent is the doc itself.
  if (kind !== "stance") {
    try {
      const newNode = await createNode({
        name,
        type,
        parentId: target?._id ? String(target._id) : null,
        beingId,
      });
      return shapeNewNode(newNode);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }

  // Stance-arrival path.
  if (target.isLandRoot) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "Cannot create-child at the land root. Create the tree under your home (~) instead.",
    );
  }
  if (target.isHomeRoot) {
    if (String(target.beingId) !== String(beingId)) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Cannot create a tree root in another being's home");
    }
    try {
      const newNode = await createNode({ name, type, isRoot: true, beingId });
      return shapeNewNode(newNode);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }
  if (!target.nodeId) {
    throw new IbpError(IBP_ERR.NODE_NOT_FOUND, "Resolved position has no nodeId");
  }
  try {
    const newNode = await createNode({ name, type, parentId: target.nodeId, beingId });
    return shapeNewNode(newNode);
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
  }
}

function shapeNewNode(newNode) {
  return {
    nodeId:   String(newNode._id),
    name:     newNode.name,
    position: `${getLandDomain()}/${String(newNode._id)}`,
  };
}

async function renameAtStance({ resolved, name, identity }) {
  const beingId = identity?.beingId || null;
  if (!resolved.nodeId) {
    throw new IbpError(IBP_ERR.NODE_NOT_FOUND, "Resolved address has no nodeId");
  }
  const access = await resolveTreeAccess(resolved.nodeId, beingId);
  if (!access?.ok || access.write !== true) {
    throw new IbpError(IBP_ERR.FORBIDDEN, "Not authorized to rename at this place");
  }
  try {
    await editNodeName({ nodeId: resolved.nodeId, newName: name, beingId });
    return { nodeId: String(resolved.nodeId), name };
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.rename);
  }
}

async function setMetaAtStance({ resolved, namespace, data, merge, identity }) {
  const beingId = identity?.beingId || null;
  if (!resolved.nodeId) {
    throw new IbpError(IBP_ERR.NODE_NOT_FOUND, "Resolved address has no nodeId");
  }
  const access = await resolveTreeAccess(resolved.nodeId, beingId);
  if (!access?.ok || access.write !== true) {
    throw new IbpError(IBP_ERR.FORBIDDEN, "Not authorized to write metadata at this place");
  }
  const node = await Node.findById(resolved.nodeId);
  if (!node) {
    throw new IbpError(IBP_ERR.NODE_NOT_FOUND, "Node disappeared between resolve and write");
  }
  try {
    if (merge === false) {
      await setExtMeta(node, namespace, data);
    } else {
      await mergeExtMeta(node, namespace, data);
    }
    return { written: true, nodeId: String(node._id), namespace, kind: "node" };
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.setMeta);
  }
}

// Auto-register on import so the registry is populated whether the caller
// is `core.do(...)` from extension code or the IBP wire dispatcher.
registerKernelOperations();
