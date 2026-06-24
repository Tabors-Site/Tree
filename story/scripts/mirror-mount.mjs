// TreeOS . MIRROR.md step 2 prototype.
//
// FUSE mount that renders source matter as a real filesystem folder
// rooted at the story. Reads stream bytes from CAS by hash (step 1).
// Writes enter the verb system through an IPC bridge to the parent
// process (step 2): each FUSE write/truncate/create/unlink/rename/
// mkdir is shipped to begin.js's mirrorProc message handler, which
// wraps the call in withIAmAct, dispatches the matching DO verb, and
// replies with a status the child maps back to a posix errno. The
// path is a live window onto the matter chain, not a copy of it.
//
// Usage: node story/scripts/mirror-mount.mjs [mount-point]
// Default mount: story/mirror/

import Fuse from "fuse-native";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { getContent } from "../seed/materials/matter/contentStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MOUNT = path.resolve(process.argv[2] || path.join(REPO_ROOT, "mirror"));

// ─── tree shape ──────────────────────────────────────────────────────
//
// We synthesize a tree of "nodes" keyed by absolute mount path. Each
// node is either a directory (carries a Set of child names) or a file
// (carries a CAS hash + size + mimeType, plus the matterId so writes
// can address it). The FUSE handlers do exact lookups against this
// map. The root IS the source root; everything the story holds bytes
// for sits under it.

const tree = new Map();
tree.set("/", { kind: "dir", entries: new Set() });

// path → matterId map (the kernel's identity for each rendered
// node). Writes carry this to the parent so the parent doesn't need
// to re-resolve.
const pathToMatterId = new Map();

// ─── IPC client to parent (step 2 write bridge) ─────────────────────
//
// process.send opens the ipc channel begin.js opened on fork. Each
// request carries a correlation id; replies resolve a pending Map.
// Timeout is generous because a write can serialize behind other
// I-Am moments on the chain (actChainLock).

const IPC_TIMEOUT_MS = 30000;
const ipcPending = new Map();
let ipcCidSeq = 1;

function ipcReady() {
  return typeof process.send === "function";
}

function ipcRequest(payload) {
  if (!ipcReady()) {
    return Promise.reject(
      Object.assign(new Error("mirror: no ipc channel"), { code: "EIO" }),
    );
  }
  const cid = `m${ipcCidSeq++}`;
  // Honor the Name primitive (philosophy/names/plan.md). Every act
  // carries nameId; the parent signs as I in step 2. Naming the
  // expectation in the envelope keeps a per-uid mount upgrade a
  // clean swap (the child only changes the nameId here; the parent
  // changes which key signs).
  const envelope = { type: "mount-write", cid, nameId: "i-am", ...payload };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcPending.delete(cid);
      reject(
        Object.assign(new Error(`mirror: ipc timeout for ${payload.op}`), {
          code: "EIO",
        }),
      );
    }, IPC_TIMEOUT_MS);
    ipcPending.set(cid, { resolve, reject, timer });
    try {
      process.send(envelope);
    } catch (err) {
      const p = ipcPending.get(cid);
      if (p) {
        clearTimeout(p.timer);
        ipcPending.delete(cid);
      }
      reject(
        Object.assign(new Error(`mirror: ipc send failed: ${err.message}`), {
          code: "EIO",
        }),
      );
    }
  });
}

// Posix errno mapping. Parent replies carry {status, error?:{code,message}}.
// Codes the parent emits map onto Fuse.* constants the kernel reads.
function fuseErrnoFor(code) {
  switch (code) {
    case "EACCES":
      return Fuse.EACCES;
    case "EEXIST":
      return Fuse.EEXIST;
    case "ENOENT":
      return Fuse.ENOENT;
    case "ENOSPC":
      return Fuse.ENOSPC;
    case "EXDEV":
      return Fuse.EXDEV;
    case "ENOTEMPTY":
      return Fuse.ENOTEMPTY;
    case "EINVAL":
      return Fuse.EINVAL;
    case "EROFS":
      return Fuse.EROFS;
    case "EIO":
      return Fuse.EIO;
    default:
      return Fuse.EIO;
  }
}

function rejectAllPending(code = "EIO") {
  for (const [cid, p] of ipcPending) {
    clearTimeout(p.timer);
    p.reject(
      Object.assign(new Error(`mirror: pending request ${cid} aborted`), {
        code,
      }),
    );
  }
  ipcPending.clear();
}

// ─── source matter (needs Mongo) ────────────────────────────────────

let sourceCount = 0;
try {
  process.env.MONGODB_URI =
    process.env.MONGODB_URI ||
    fs
      .readFileSync(path.join(REPO_ROOT, ".env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("MONGODB_URI="))
      ?.split("=")[1]
      ?.trim();

  if (process.env.MONGODB_URI) {
    const { default: mongoose } = await import("mongoose");
    await mongoose.connect(process.env.MONGODB_URI);
    const { default: Projection } =
      await import("../seed/materials/history/projection.js");

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
      // Only render paths under REPO_ROOT (the story's checkout).
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
        if (!tree.has(next))
          tree.set(next, { kind: "dir", entries: new Set() });
        cur = next;
      }
      const leaf = parts[parts.length - 1];
      tree.get(cur).entries.add(leaf);
      const kind = row.state.content.kind === "directory" ? "dir" : "file";
      pathToMatterId.set(mountPath, String(row.id));
      if (kind === "dir") {
        if (!tree.has(mountPath))
          tree.set(mountPath, { kind: "dir", entries: new Set() });
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
    console.error(
      "No MONGODB_URI in env. Story must be running for the mirror to read source matter.",
    );
    process.exit(2);
  }
} catch (err) {
  console.error(`Source enumeration failed: ${err.message}`);
  process.exit(2);
}

// ─── parent-pushed invalidates ──────────────────────────────────────
//
// After a successful seal the parent sends `{type:"mount-invalidate",
// path, ...}` so the local tree reflects the just-written content on
// the next read. Out-of-band writes (other beings editing matter
// through the portal while the mount is up) are out of scope for
// step 2; step 3 generalizes this seam by subscribing to matter facts.

process.on?.("message", (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "mount-reply") {
    const p = ipcPending.get(msg.cid);
    if (!p) return;
    clearTimeout(p.timer);
    ipcPending.delete(msg.cid);
    if (msg.status === "ok") p.resolve(msg.data || {});
    else
      p.reject(
        Object.assign(new Error(msg.error?.message || "mirror: ipc error"), {
          code: msg.error?.code || "EIO",
        }),
      );
    return;
  }
  if (msg.type === "mount-invalidate") {
    applyInvalidate(msg);
    return;
  }
});

function applyInvalidate(msg) {
  const p = msg.path;
  if (typeof p !== "string" || !p.length) return;
  if (msg.removed) {
    // Drop the node and its entry from the parent's child set.
    const node = tree.get(p);
    if (node) tree.delete(p);
    pathToMatterId.delete(p);
    const parentDir = p === "/" ? "/" : path.posix.dirname(p);
    const leaf = path.posix.basename(p);
    const parent = tree.get(parentDir);
    if (parent && parent.kind === "dir") parent.entries.delete(leaf);
    return;
  }
  if (msg.kind === "dir") {
    if (!tree.has(p)) tree.set(p, { kind: "dir", entries: new Set() });
    if (msg.matterId) pathToMatterId.set(p, String(msg.matterId));
  } else if (msg.kind === "file") {
    tree.set(p, {
      kind: "file",
      hash: msg.hash || null,
      size: typeof msg.size === "number" ? msg.size : 0,
      mimeType: msg.mimeType || null,
    });
    if (msg.matterId) pathToMatterId.set(p, String(msg.matterId));
  } else if (msg.renamed && typeof msg.from === "string") {
    // Shape: { renamed:true, from, path:to }
    const node = tree.get(msg.from);
    if (node) {
      tree.delete(msg.from);
      tree.set(p, node);
    }
    const mId = pathToMatterId.get(msg.from);
    pathToMatterId.delete(msg.from);
    if (mId) pathToMatterId.set(p, mId);
    const fromParent = path.posix.dirname(msg.from);
    const toParent = path.posix.dirname(p);
    const fromLeaf = path.posix.basename(msg.from);
    const toLeaf = path.posix.basename(p);
    const fp = tree.get(fromParent);
    if (fp && fp.kind === "dir") fp.entries.delete(fromLeaf);
    const tp = tree.get(toParent);
    if (tp && tp.kind === "dir") tp.entries.add(toLeaf);
  }
  // Ensure the parent dir entry tracks the leaf for create-style.
  if (!msg.renamed && !msg.removed) {
    const parentDir = p === "/" ? "/" : path.posix.dirname(p);
    const leaf = path.posix.basename(p);
    const parent = tree.get(parentDir);
    if (parent && parent.kind === "dir") parent.entries.add(leaf);
  }
}

// ─── FUSE handlers ──────────────────────────────────────────────────

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const now = new Date();

// Synthesize a CAS-ish hash for write-shaped tracking: we don't keep
// blobs in the child; we just re-read on the next FUSE read after an
// invalidate carries the new hash. Used only for ENOENT shaping.

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
      mtime: now,
      atime: now,
      ctime: now,
      nlink: node.kind === "dir" ? 2 : 1,
      size: node.size || 0,
      mode: node.kind === "dir" ? 0o40755 : 0o100644,
      uid,
      gid,
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

  // ── writes ────────────────────────────────────────────────────
  //
  // Every write ships full bytes for the matter: the parent splices
  // the new bytes at offset against the current content, puts the
  // result into CAS, and stamps a set-matter:content fact. The mount
  // does not hold its own write buffer; the chain is the buffer.

  write: async (p, fd, buf, len, pos, cb) => {
    const node = tree.get(p);
    if (!node || node.kind !== "file") return cb(Fuse.ENOENT);
    const matterId = pathToMatterId.get(p);
    if (!matterId) return cb(Fuse.ENOENT);
    try {
      const slice = Buffer.from(buf.slice(0, len));
      const reply = await ipcRequest({
        op: "write",
        path: p,
        matterId,
        offset: pos,
        bytes: slice.toString("base64"),
      });
      // Reflect the new size/hash immediately so a same-path read sees
      // the splice without round-tripping for an invalidate.
      if (reply.hash) {
        node.hash = reply.hash;
        if (typeof reply.size === "number") node.size = reply.size;
      }
      cb(len);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  truncate: async (p, size, cb) => {
    const node = tree.get(p);
    if (!node || node.kind !== "file") return cb(Fuse.ENOENT);
    const matterId = pathToMatterId.get(p);
    if (!matterId) return cb(Fuse.ENOENT);
    try {
      const reply = await ipcRequest({
        op: "truncate",
        path: p,
        matterId,
        size,
      });
      if (reply.hash !== undefined) {
        node.hash = reply.hash;
        node.size = typeof reply.size === "number" ? reply.size : 0;
      }
      cb(0);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  ftruncate: async (p, fd, size, cb) => {
    return handlers.truncate(p, size, cb);
  },

  create: async (p, mode, cb) => {
    const parentDir = path.posix.dirname(p);
    const parentNode = tree.get(parentDir);
    if (!parentNode || parentNode.kind !== "dir") return cb(Fuse.ENOENT);
    const leaf = path.posix.basename(p);
    if (tree.has(p)) return cb(Fuse.EEXIST);
    const parentMatterId = pathToMatterId.get(parentDir) || null;
    try {
      const reply = await ipcRequest({
        op: "create",
        path: p,
        parentPath: parentDir,
        parentMatterId,
        name: leaf,
        mode,
      });
      const newMatterId = reply.matterId;
      tree.set(p, {
        kind: "file",
        hash: reply.hash || null,
        size: reply.size || 0,
        mimeType: null,
      });
      if (newMatterId) pathToMatterId.set(p, String(newMatterId));
      parentNode.entries.add(leaf);
      cb(0, 42);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  unlink: async (p, cb) => {
    const node = tree.get(p);
    if (!node) return cb(Fuse.ENOENT);
    const matterId = pathToMatterId.get(p);
    if (!matterId) return cb(Fuse.ENOENT);
    try {
      await ipcRequest({ op: "unlink", path: p, matterId });
      tree.delete(p);
      pathToMatterId.delete(p);
      const parentDir = path.posix.dirname(p);
      const parent = tree.get(parentDir);
      if (parent && parent.kind === "dir")
        parent.entries.delete(path.posix.basename(p));
      cb(0);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  rename: async (oldPath, newPath, cb) => {
    const node = tree.get(oldPath);
    if (!node) return cb(Fuse.ENOENT);
    const matterId = pathToMatterId.get(oldPath);
    if (!matterId) return cb(Fuse.ENOENT);
    const oldParent = path.posix.dirname(oldPath);
    const newParent = path.posix.dirname(newPath);
    const newLeaf = path.posix.basename(newPath);
    const newParentMatterId = pathToMatterId.get(newParent) || null;
    // Atomic rename-replace. POSIX rename(2) replaces the destination
    // when it exists (vim, sed, and most editors save through this
    // pattern: write a temp file, rename temp over the original). We
    // forward the displaced matterId so the parent can end it in the
    // same moment as the rename.
    const replaceMatterId = tree.has(newPath)
      ? pathToMatterId.get(newPath) || null
      : null;
    try {
      await ipcRequest({
        op: "rename",
        path: newPath,
        from: oldPath,
        matterId,
        oldParent,
        newParent,
        newParentMatterId,
        newName: newLeaf,
        sameParent: oldParent === newParent,
        replace: replaceMatterId != null,
        replaceMatterId,
      });
      const tmp = tree.get(oldPath);
      tree.delete(oldPath);
      if (replaceMatterId) {
        tree.delete(newPath);
      }
      tree.set(newPath, tmp);
      pathToMatterId.delete(oldPath);
      if (replaceMatterId) pathToMatterId.delete(newPath);
      pathToMatterId.set(newPath, matterId);
      const op = tree.get(oldParent);
      if (op && op.kind === "dir")
        op.entries.delete(path.posix.basename(oldPath));
      const np = tree.get(newParent);
      if (np && np.kind === "dir") np.entries.add(newLeaf);
      cb(0);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  mkdir: async (p, mode, cb) => {
    const parentDir = path.posix.dirname(p);
    const parentNode = tree.get(parentDir);
    if (!parentNode || parentNode.kind !== "dir") return cb(Fuse.ENOENT);
    if (tree.has(p)) return cb(Fuse.EEXIST);
    const leaf = path.posix.basename(p);
    const parentMatterId = pathToMatterId.get(parentDir) || null;
    try {
      const reply = await ipcRequest({
        op: "mkdir",
        path: p,
        parentPath: parentDir,
        parentMatterId,
        name: leaf,
        mode,
      });
      tree.set(p, { kind: "dir", entries: new Set() });
      if (reply.matterId) pathToMatterId.set(p, String(reply.matterId));
      parentNode.entries.add(leaf);
      cb(0);
    } catch (err) {
      cb(fuseErrnoFor(err.code));
    }
  },

  // Step-2 deferrals: tools that probe these must not fail loudly on
  // a no-op surface.
  chmod: (p, mode, cb) => cb(0),
  chown: (p, uid, gid, cb) => cb(Fuse.ENOTSUP),
  symlink: (target, link, cb) => cb(Fuse.ENOTSUP),
  rmdir: (p, cb) => cb(Fuse.ENOTSUP),
};

// ─── mount ──────────────────────────────────────────────────────────

// A prior FUSE mount that died leaves MOUNT dangling ("Transport endpoint is not
// connected"), so mkdirSync below fails ENOTCONN and boot dies. Clear ONLY a stale
// mount (ENOTCONN on stat), never a healthy one — so a crashed mount self-heals.
try {
  fs.statSync(MOUNT);
} catch (e) {
  if (e && e.code === "ENOTCONN") {
    for (const tool of ["fusermount", "fusermount3"]) {
      try {
        execSync(`${tool} -u ${JSON.stringify(MOUNT)}`, { stdio: "ignore" });
        break;
      } catch {}
    }
  }
}
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
  // Inflight ipc requests must fail honestly so any blocked FUSE
  // callback unwinds and fuse-native can unmount.
  rejectAllPending("EIO");
  fuse.unmount((err) => {
    if (err) console.error(`unmount err: ${err.message}`);
    process.exit(0);
  });
};
process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);
process.on("SIGHUP", teardown);
