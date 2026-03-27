import mongoose from "mongoose";

const ExtensionSchema = new mongoose.Schema({
  // Package identity
  name: { type: String, required: true },
  version: { type: String, required: true },
  description: { type: String, default: "" },

  // Package taxonomy
  type: {
    type: String,
    enum: ["extension", "bundle", "os"],
    default: "extension",
  },
  builtFor: { type: String, default: "kernel" },

  // Bundle fields: extensions this bundle includes
  includes: [{ type: String }],

  // OS fields: bundles, standalone extensions, config, orchestrators
  bundles: [{ type: String }],
  standalone: [{ type: String }],
  osConfig: { type: mongoose.Schema.Types.Mixed, default: null },
  osOrchestrators: { type: mongoose.Schema.Types.Mixed, default: null },

  // Author (the land that originally published)
  authorLandId: { type: String, required: true },
  authorDomain: { type: String, required: true },
  authorName: { type: String, default: "" },

  // Additional lands allowed to publish updates (land domains)
  maintainers: [{ type: String }],

  // Manifest (the full contract)
  manifest: { type: mongoose.Schema.Types.Mixed, required: true },

  // Source
  repoUrl: { type: String, default: null },
  tarballUrl: { type: String, default: null },

  // File contents (for small extensions, stored inline)
  files: [{
    path: { type: String, required: true },
    content: { type: String, required: true },
  }],

  // Integrity
  checksum: { type: String, default: null },

  // Size stats (computed on publish)
  totalLines: { type: Number, default: 0 },
  totalBytes: { type: Number, default: 0 },
  fileCount: { type: Number, default: 0 },

  // Metadata
  publishedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  downloads: { type: Number, default: 0 },

  // Discovery
  tags: [{ type: String }],
  readme: { type: String, default: "" },

  // Dependency visibility (denormalized from manifest.needs.npm)
  npmDependencies: [{ type: String }],
});

// name + version must be unique (like npm)
ExtensionSchema.index({ name: 1, version: 1 }, { unique: true });
ExtensionSchema.index({ name: 1 });
ExtensionSchema.index({ tags: 1 });
ExtensionSchema.index({ authorLandId: 1 });
ExtensionSchema.index({ type: 1 });
ExtensionSchema.index({ builtFor: 1 });
ExtensionSchema.index({ type: 1, builtFor: 1 });
ExtensionSchema.index({ name: "text", description: "text", tags: "text" });

const Extension = mongoose.model("Extension", ExtensionSchema);

export default Extension;
