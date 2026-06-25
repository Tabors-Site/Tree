// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// native.js — loads the compiled Rust hash addon (rust/treehash-node, the napi wrapper over the
// Tier-1 treehash crate). This is the SINGLE SOURCE OF TRUTH for the content-hash: hash.js + actHash.js
// are pure bindings to it, NOT shims with a JS fallback.
//
// PURE RUST, NO BACKUP (Tabor: "you need rust and no js backup; if you don't have it you can't run").
// A missing/unbuilt addon is a hard boot error naming the build command — there is no JS path to fall
// back to, because there is no JS implementation anymore (the logic lives in rust/treehash, proven
// byte-identical by 43/43 golden vectors + the live-chain parity harness). The addon loads ONCE here.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// seed/past/fact/ → ../../../ is the repo root, then the compiled cdylib renamed to .node.
const ADDON = join(__dirname, "../../../rust/treehash-node/treehash_node.node");

function load() {
  if (!existsSync(ADDON)) {
    throw new Error(
      `[treeos] native hash addon not built: ${ADDON}\n` +
        `  TreeOS runs on Rust — build it first:\n` +
        `    npm run build:native      (or: cd rust/treehash-node && cargo build --release)\n`,
    );
  }
  const require = createRequire(import.meta.url);
  return require(ADDON);
}

/** The loaded Rust hash addon. Eager (required at first import); the .node is loaded once. */
export const native = load();
