// TreeOS . Publish-story helper.
//
// Reads every file under the running story's source-matter tree,
// builds a tree blob in CAS that names them all by hash, and prints
// the publish manifest you'd hand the registrar. The publish itself
// is one summon away (`@store-registrar` with intent publish-listing,
// passing this manifest + listingType: "pack").
//
// A story publish IS a pack publish whose tree happens to span the
// entire repo. Same primitive, same listing type, larger scope. ONE
// asset in the manifest, the tree hash. The tree blob lives in
// localStore CAS like any other content; recipients pull by hash and
// unpack.
//
// Usage: node story/scripts/publish-story.mjs [name] [version]
//   defaults: name from .env's STORY_NAME or "story", version 1.0.0
//
// Does NOT call the publish intent automatically; prints the manifest
// + listingHash so you can summon the registrar by hand (or pipe it).

import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { putContent } from "../seed/materials/matter/contentStore.js";
import { buildTreeBlob } from "../seed/materials/matter/anchor.js";
import { listingHashOf } from "../resources/store/code/lib/claims.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const NAME    = process.argv[2] || process.env.STORY_NAME || "story";
const VERSION = process.argv[3] || "1.0.0";

// Load .env if env isn't set yet.
if (!process.env.MONGODB_URI) {
  try {
    const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
    const line = envText.split("\n").find((l) => l.startsWith("MONGODB_URI="));
    if (line) process.env.MONGODB_URI = line.split("=")[1].trim();
  } catch {}
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI not set. Story must be running so source matter is queryable.");
  process.exit(2);
}

await mongoose.connect(process.env.MONGODB_URI);
const { default: Projection } = await import("../seed/materials/branch/projection.js");

// Walk source matter: every file under REPO_ROOT whose content has a hash.
const rows = await Projection.find({
  branch: "0", type: "matter",
  "state.content.kind": "file",
  "state.content.hash": { $exists: true },
}).lean();

const files = [];
for (const row of rows) {
  const diskPath = row.state?.content?.path;
  if (typeof diskPath !== "string") continue;
  const rel = path.relative(REPO_ROOT, diskPath);
  if (rel === "" || rel.startsWith("..")) continue;
  files.push({
    path:     rel,
    hash:     row.state.content.hash,
    size:     row.state.content.size || 0,
    mimeType: row.state.content.mimeType || null,
  });
}

if (files.length === 0) {
  console.error("No anchored source files found. Has the story booted with source.js running?");
  await mongoose.disconnect();
  process.exit(2);
}

// Build the tree blob, put it in CAS, get its hash.
const { treeHash, treeSize } = await buildTreeBlob(files, putContent, {
  name:    NAME,
  version: VERSION,
});

// Build the publish manifest. Same shape as a pack manifest: assets[]
// carries content hashes. For a story, exactly one asset — the tree.
const manifest = {
  name:        NAME,
  version:     VERSION,
  description: `Story ${NAME} as of ${treeHash.slice(0, 12)} (${files.length} files).`,
  assets: [
    { hash: treeHash, label: "tree", size: treeSize },
  ],
};

const listingHash = listingHashOf(manifest);

console.log("");
console.log("─── publish-story ───");
console.log(`name:        ${NAME}`);
console.log(`version:     ${VERSION}`);
console.log(`files:       ${files.length}`);
console.log(`tree hash:   ${treeHash}`);
console.log(`tree size:   ${treeSize} bytes`);
console.log(`listingHash: ${listingHash}`);
console.log("");
console.log("Manifest to summon @store-registrar with:");
console.log("");
console.log(JSON.stringify({ listingType: "pack", manifest }, null, 2));
console.log("");
console.log("Next step (manual): summon @store-registrar from a being holding the store:publisher role");
console.log("with intent 'publish-listing' and the payload above.");

await mongoose.disconnect();
