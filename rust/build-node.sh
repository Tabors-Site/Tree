#!/usr/bin/env bash
# Build the Rust hash addon (rust/treehash-node) and place it where seed/past/fact/native.js loads it.
# TreeOS runs on Rust — this must succeed before `npm start` / `npm test` (there is no JS fallback).
set -euo pipefail
cd "$(dirname "$0")/treehash-node"

cargo build --release

# Copy the platform cdylib (linux .so / macOS .dylib / windows .dll) to the .node node loads.
for f in \
  target/release/libtreehash_node.so \
  target/release/libtreehash_node.dylib \
  target/release/treehash_node.dll; do
  if [ -f "$f" ]; then
    cp "$f" treehash_node.node
    echo "built treehash_node.node  <-  $f"
    exit 0
  fi
done

echo "build-node.sh: no cdylib produced under target/release/" >&2
exit 1
