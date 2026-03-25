import mongoose from "mongoose";

/**
 * Burned version numbers. When a version is unpublished, its name+version
 * pair is recorded here permanently. The publish endpoint checks this
 * collection before accepting a new version, ensuring version numbers
 * are append-only: once used, a version string can never be reused,
 * even after unpublish. This closes the unpublish-republish mutation
 * loophole that npm learned the hard way.
 */
const ExtensionTombstoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  version: { type: String, required: true },
  checksum: { type: String, default: null },
  authorLandId: { type: String, required: true },
  unpublishedAt: { type: Date, default: Date.now },
});

ExtensionTombstoneSchema.index({ name: 1, version: 1 }, { unique: true });

const ExtensionTombstone = mongoose.model("ExtensionTombstone", ExtensionTombstoneSchema);

export default ExtensionTombstone;
