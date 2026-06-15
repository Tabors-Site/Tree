// TreeOS . MIRROR.md step 1 prototype.
//
// Read-only FUSE mount that renders source matter as a filesystem
// folder rooted at the reality. Source matter is the whole repo
// (source.js anchors every file's bytes into CAS during its walk;
// each matter row carries a content.hash). The mount reads bytes by
// hash from localStore. One tree. Resources live where they really
// live: under `resources/` in the source walk. Publish reads the
// same source matter through a tree blob (publish-reality.mjs).
//
// Usage: node reality/scripts/mirror-mount.mjs [mount-point]
// Default mount: reality/mirror/

import Fuse from "fuse-native";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getContent } from "../seed/materials/matter/contentStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MOUNT = path.resolve(process.argv[2] || path.join(REPO_ROOT, "mirror"));

// ─── tree shape ──────────────────────────────────────────────────────
//
// We synthesize a tree of "nodes" keyed by absolute mount path. Each
// node is either a directory (carries a Set of child names) or a file
// (carries a CAS hash + size + mimeType). The FUSE handlers do exact
// lookups against this map. The root IS the source root; everything
// the reality holds bytes for sits under it.

const tree = new Map();
tree.set("/", { kind: "dir", entries: new Set() });

// ─── source matter (needs Mongo) ────────────────────────────────────

let sourceCount = 0;
try {
  process.env.MONGODB_URI = process.env.MONGODB_URI || fs.readFileSync(
    path.join(REPO_ROOT, ".env"), "utf8",
  ).split("\n").find((l) => l.startsWith("MONGODB_URI="))?.split("=")[1]?.trim();

  if (process.env.MONGODB_URI) {
    const { default: mongoose } = await import("mongoose");
    await mongoose.connect(process.env.MONGODB_URI);
    const { default: Projection } = await import("../seed/materials/branch/projection.js");

    // source matters: type=matter, state.content.kind in {"file","directory"},
    // state.content.path is the absolute disk path.
    const rows = await Projection.find({
      branch: "0",
      type: "matter",
      "state.content.kind": { $in: ["file", "directory"] },
      "state.content.path": { $exists: true },
    }).lean();

    for (const row of rows) {
      const diskPath = row.state?.content?.path;
      if (!diskPath || typeof diskPath !== "string") continue;
      // Only render paths under REPO_ROOT (the reality's checkout).
      const rel = path.relative(REPO_ROOT, diskPath);
      if (rel.startsWith("..")) continue;
      // The source-space root matter has rel === "" (diskPath ===
      // REPO_ROOT). It IS the mount root, no entry to add.
      if (rel === "") continue;
      const mountPath = `/${rel}`;
      const parts = rel.split("/");
      let cur = "/";
      for (let i = 0; i < parts.length - 1; i++) {
        tree.get(cur).entries.add(parts[i]);
        const next = cur === "/" ? `/${parts[i]}` : `${cur}/${parts[i]}`;
        if (!tree.has(next)) tree.set(next, { kind: "dir", entries: new Set() });
        cur = next;
      }
      const leaf = parts[parts.length - 1];
      tree.get(cur).entries.add(leaf);
      const kind = row.state.content.kind === "directory" ? "dir" : "file";
      if (kind === "dir") {
        if (!tree.has(mountPath)) tree.set(mountPath, { kind: "dir", entries: new Set() });
      } else {
        const hash = row.state.content.hash;
        if (!hash) continue; // unanchored (oversize or pre-anchor data): no render.
        tree.set(mountPath, {
          kind: "file",
          hash,
          size: row.state.content.size || 0,
          mimeType: row.state.content.mimeType || null,
        });
        sourceCount++;
      }
    }
    console.log(`Loaded ${sourceCount} files from matter projections.`);
    await mongoose.disconnect();
  } else {
    console.error("No MONGODB_URI in env. Reality must be running for the mirror to read source matter.");
    process.exit(2);
  }
} catch (err) {
  console.error(`Source enumeration failed: ${err.message}`);
  process.exit(2);
}

// ─── FUSE handlers ──────────────────────────────────────────────────

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const now = new Date();

const handlers = {
  init: (cb) => cb(0),

  readdir: (p, cb) => {
    const node = tree.get(p);
    if (!node) return cb(Fuse.ENOENT);
    if (node.kind !== "dir") return cb(Fuse.ENOTDIR);
    cb(0, [...node.entries]);
  },

  getattr: (p, cb) => {
    const node = tree.get(p);
    if (!node) return cb(Fuse.ENOENT);
    cb(0, {
      mtime: now, atime: now, ctime: now,
      nlink: node.kind === "dir" ? 2 : 1,
      size: node.size || 0,
      mode: node.kind === "dir" ? 0o40755 : 0o100644,
      uid, gid,
    });
  },

  open: (p, flags, cb) => cb(0, 42),
  release: (p, fd, cb) => cb(0),

  read: async (p, fd, buf, len, pos, cb) => {
    const node = tree.get(p);
    if (!node || node.kind !== "file" || !node.hash) return cb(0);
    try {
      const bytes = await getContent(node.hash);
      if (pos >= bytes.length) return cb(0);
      const slice = bytes.subarray(pos, Math.min(pos + len, bytes.length));
      slice.copy(buf, 0);
      cb(slice.length);
    } catch (err) {
      console.error(`read err at ${p}: ${err.message}`);
      cb(0);
    }
  },
};

// ─── mount ──────────────────────────────────────────────────────────

fs.mkdirSync(MOUNT, { recursive: true });
const fuse = new Fuse(MOUNT, handlers, { force: true, mkdir: true });

fuse.mount((err) => {
  if (err) {
    console.error(`mount failed: ${err.message}`);
    process.exit(1);
  }
  console.log(`Mirror mounted at ${MOUNT}`);
});

const teardown = () => {
  fuse.unmount((err) => {
    if (err) console.error(`unmount err: ${err.message}`);
    process.exit(0);
  });
};
process.on("SIGINT",  teardown);
process.on("SIGTERM", teardown);
process.on("SIGHUP",  teardown);
