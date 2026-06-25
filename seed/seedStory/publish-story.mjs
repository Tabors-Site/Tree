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
// Usage: node story/seed/seedStory/publish-story.mjs [name] [version]
//   defaults: name from .env's STORY_NAME or "story", version 1.0.0
//
// Does NOT call the publish intent automatically; prints the manifest
// + listingHash so you can summon the registrar by hand (or pipe it).

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { putContent } from "../materials/matter/contentStore.js";
import { buildTreeBlob } from "../materials/matter/anchor.js";
import { listingHashOf } from "../../shared/store/code/lib/claims.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const NAME    = process.argv[2] || process.env.STORY_NAME || "story";
const VERSION = process.argv[3] || "1.0.0";

// Open the file store; the folded matter projections are read from files.
const { connectDB } = await import("./dbConfig.js");
await connectDB();
const { listByType, loadOrFold } = await import("../materials/projections.js");

// Walk source matter: every file matter under REPO_ROOT whose content has a hash.
const rows = [];
for (const o of await listByType("matter", "0")) {
  const slot = await loadOrFold("matter", String(o.id), "0");
  if (slot && !slot.tombstoned && slot.state?.content?.kind === "file" && slot.state?.content?.hash) {
    rows.push({ id: String(o.id), state: slot.state });
  }
}

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
console.log("Next step (manual): summon @store-registrar from a being holding the store:publisher able");
console.log("with intent 'publish-listing' and the payload above.");
// The file store needs no teardown; nothing to disconnect.
