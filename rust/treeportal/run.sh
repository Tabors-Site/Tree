#!/usr/bin/env bash
# Launch treeos (server) + treeportal (the GUI) together.
# Run this on a machine that HAS a display — a real one, an SSH-forwarded one (ssh -Y), or a virtual
# one (Xvfb). The portal connects to treeos over WebSocket.
#
#   ./run.sh                      # 127.0.0.1:7070, store/past
#   ADDR=0.0.0.0:7070 ./run.sh    # bind all interfaces (LAN reachable)
#   STORE=/path/to/store ./run.sh
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # repo root (…/Tree)
ADDR="${ADDR:-127.0.0.1:7070}"
STORE="${STORE:-$ROOT/store/past}"
BIN="$ROOT/rust/target/debug"

echo "== building treeos + treeportal =="
( cd "$ROOT/rust" && cargo build -p treeos -p treeportal )

# start the server in the background if it isn't already answering
if ! curl -s "http://$ADDR/health" >/dev/null 2>&1; then
  echo "== starting treeos on $ADDR (log: /tmp/treeos.log) =="
  "$BIN/treeos" serve "$ADDR" "$STORE" >/tmp/treeos.log 2>&1 &
  sleep 1
else
  echo "== treeos already serving on $ADDR =="
fi

echo "== launching portal -> ws://$ADDR/ws  (DISPLAY=$DISPLAY) =="
# If the window fails to open with an OpenGL/GLX error over SSH, prepend: LIBGL_ALWAYS_SOFTWARE=1
exec "$BIN/treeportal" "ws://$ADDR/ws"
