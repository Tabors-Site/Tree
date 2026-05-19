// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Artifact: a thing that lives inside a node.
//
// An artifact is the kernel's universal "something at a position" primitive.
// It replaces the older Note model. A node is a position; an artifact is
// something the position holds. Artifacts subsume what we used to call
// notes, files, and metadata-only objects.
//
// The axis is origin, not type. Origin captures what system the artifact's
// underlying representation comes from. It determines fetching, storage,
// synchronization, addressing, and transfer.
//
//   ibp        : TreeOS native. content is a string of text or null
//                (metadata-only object). The artifact's metadata is its
//                truth. Always in sync because TreeOS owns it.
//   filesystem : Bridges to a file on disk. content is { path, size,
//                mimeType }. The bytes live outside TreeOS.
//   web        : Bridges to a URL. content is { url, fetchedAt?, cache? }.
//                Live content lives on the web.
//   cross-land : Bridges to an artifact on another TreeOS land.
//                content is { land, artifactRef }. The artifact lives
//                in the other land.
//
// Future origins (git, database, stream, service) plug in as new bridging
// patterns. Schema does not change; origin enum extends, renderers and
// fetchers handle the new origin.

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { ARTIFACT_ORIGIN } from "../core/protocol.js";

const ArtifactSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  nodeId: {
    type: String,
    ref: "Node",
    required: true,
  },
  beingId: {
    type: String,
    ref: "Being",
    required: true,
  },
  // ── Name ──
  // Human-readable identifier for this artifact. Used by set-name and
  // for filesystem-origin/etc. mirroring. Optional . pure-metadata
  // artifacts may not need a name. Capped at the same length the kernel
  // applies to Node.name.
  name: {
    type: String,
    default: null,
  },
  // ── Artifact tree ──
  // Artifacts form a recursive tree (the third tree in the substrate,
  // alongside positions and beings). A root artifact at a node carries
  // parentArtifactId: null; descendants chain through parentArtifactId.
  // Enables filesystem-origin folder-and-file structures, recursive
  // emission/step hierarchies for governing, etc.
  //
  // See [[project_substrate_as_universal_workspace]] for the framing
  // (recursive artifacts with origin tags = the universal-workspace
  // bridge to external hierarchical systems).
  parentArtifactId: { type: String, ref: "Artifact", default: null, index: true },
  children:         [{ type: String, ref: "Artifact" }],
  // What system the underlying representation comes from. See protocol.js
  // ARTIFACT_ORIGIN. Defaults to ibp because that is the common case
  // (TreeOS native content). Origin is required so callers cannot create
  // artifacts whose handling is ambiguous.
  origin: {
    type: String,
    enum: Object.values(ARTIFACT_ORIGIN),
    default: ARTIFACT_ORIGIN.IBP,
    required: true,
  },
  // Shape varies by origin. See ARTIFACT_ORIGIN in protocol.js for the
  // contract per origin. Optional so an artifact can be a pure
  // metadata-only object (origin "ibp" with no content).
  content: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Extensions tag artifacts via metadata. Each extension uses its own namespace.
// maxArtifactsPerNode (config, default 1000) checked in createArtifact before write.
// Retention: kernel deletes artifacts when their nodeId is set to DELETED (soft-delete).

ArtifactSchema.index({ nodeId: 1, createdAt: -1 });
ArtifactSchema.index({ beingId: 1, createdAt: -1 });
ArtifactSchema.index({ origin: 1 });

ArtifactSchema.pre("save", function (next) {
  if (!this.isNew) this.updatedAt = new Date();
  next();
});

const Artifact = mongoose.model("Artifact", ArtifactSchema, "artifacts");
export default Artifact;
