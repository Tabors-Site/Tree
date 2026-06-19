// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// websocket-pool ops. One SEE op: connections — the live socket.io
// registry joined with the connection matter rows in
// ./host/websocket. Pure read, no facts; gated by canSee.

import { registerSeeOperation } from "../../../ibp/seeOps.js";

export function registerWebsocketPoolOps() {
  // Explicit genesis entry point; registration runs at module load.
}

registerSeeOperation("connections", {
  description:
    "Live WebSocket connections: the socket registry joined with " +
    "connection matter in ./host/websocket, plus any orphan rows.",
  args: {},
  handler: async () => {
    const { getIO } = await import("../../../ibp/pushChannel.js");
    const { getHostIds } = await import("../../../materials/host/host.js");

    const io = getIO();
    const live = [];
    if (io) {
      for (const [id, s] of io.sockets.sockets) {
        live.push({
          socketId: id,
          beingId: s.beingId || null,
          name: s.name || null,
          clientKind: s.clientKind || null,
          clientInstance: s.clientInstance || null,
          branch: s.currentHistory || "0",
          path: s.currentPath || "/",
        });
      }
    }

    const wsSpace = getHostIds().wsSpace;
    let rows = [];
    if (wsSpace) {
      const { default: Projection } = await import("../../../materials/history/projection.js");
      rows = await Projection.find({
        history: "0", type: "matter",
        "state.spaceId": wsSpace,
        "state.type": "connection",
        tombstoned: { $ne: true },
      }).lean();
    }
    const bySocket = new Map(
      rows.map((r) => [r.state?.qualities?.connection?.socketId, r]),
    );

    return {
      count: live.length,
      connections: live.map((s) => ({
        ...s,
        matterId: bySocket.get(s.socketId) ? String(bySocket.get(s.socketId).id) : null,
        connectedAt: bySocket.get(s.socketId)?.state?.qualities?.connection?.connectedAt || null,
      })),
      // Rows with no live socket: lag (stamp in flight) or leftovers
      // the next boot's sweep will end.
      orphanMatter: rows
        .filter((r) => !live.some((s) => s.socketId === r.state?.qualities?.connection?.socketId))
        .map((r) => String(r.id)),
    };
  },
});
