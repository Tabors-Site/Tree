#!/usr/bin/env bash
# One-click launch: start treeos (if it isn't already up) + open the portal. Uses the prebuilt RELEASE
# binary (falls back to debug). No rebuild — fast enough to bind to a desktop icon / double-click.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root (…/Tree)
ADDR="${ADDR:-127.0.0.1:7070}"
STORE="${STORE:-$ROOT/store/past}"

BIN="$ROOT/rust/target/release"
[ -x "$BIN/treeportal" ] || BIN="$ROOT/rust/target/debug"

# no GPU (headless box / VNC desktop) -> use Mesa software GL (llvmpipe) so the window still renders
[ -d /dev/dri ] || export LIBGL_ALWAYS_SOFTWARE=1

if ! curl -s "http://$ADDR/health" >/dev/null 2>&1; then
  "$BIN/treeos" serve "$ADDR" "$STORE" >/tmp/treeos.log 2>&1 &
  sleep 1
fi
exec "$BIN/treeportal" "ws://$ADDR/ws"
