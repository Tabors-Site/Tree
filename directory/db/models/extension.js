import mongoose from "mongoose";

const ExtensionSchema = new mongoose.Schema({
  // Package identity
  name: { type: String, required: true },
  version: { type: String, required: true },
  description: { type: String, default: "" },

  // Author
  authorLandId: { type: String, required: true },
  authorDomain: { type: String, required: true },
  authorName: { type: String, default: "" },

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

  // Metadata
  publishedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  downloads: { type: Number, default: 0 },

  // Discovery
  tags: [{ type: String }],
  readme: { type: String, default: "" },
});

// name + version must be unique (like npm)
ExtensionSchema.index({ name: 1, version: 1 }, { unique: true });
ExtensionSchema.index({ name: 1 });
ExtensionSchema.index({ tags: 1 });
ExtensionSchema.index({ authorLandId: 1 });
ExtensionSchema.index({ name: "text", description: "text", tags: "text" });

const Extension = mongoose.model("Extension", ExtensionSchema);

export default Extension;
