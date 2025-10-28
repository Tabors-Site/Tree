// websocket.js
import { Server } from "socket.io";
import { connectToMCP, mcpClients, conversations } from "../mcp/client.js";

let io;
const userSockets = new Map(); // key: "rootId:username" → socket.id

export function initWebSocketServer(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("register", async ({ rootId, username }) => {
      if (!rootId || !username) return;
      const key = `${rootId}:${username}`;

      // If this user already has a registered socket, close the old one to avoid multiples
      const oldSocketId = userSockets.get(key);
      if (oldSocketId && oldSocketId !== socket.id) {
        console.log(`Replacing old socket for ${key}`);
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      userSockets.set(key, socket.id);
      console.log(`Registered socket for ${key}`);

      try {
        const client = await connectToMCP(
          "http://localhost:3000/mcp",
          rootId,
          username
        );
        mcpClients.set(key, client);
        console.log(`MCP client ready for ${key}`);
      } catch (err) {
        console.error(`MCP connection failed for ${key}:`, err);
      }

      logStats();
    });

    socket.on("disconnect", async (reason) => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`);

      for (const [key, id] of userSockets.entries()) {
        if (id === socket.id) {
          userSockets.delete(key);
          conversations.delete(key);

          const mcpClient = mcpClients.get(key);
          if (mcpClient) {
            try {
              if (typeof mcpClient.close === "function") {
                await mcpClient.close();
                console.log(`Closed MCP client for ${key}`);
              } else if (mcpClient.transport?.close) {
                await mcpClient.transport.close();
                console.log(`Closed MCP transport for ${key}`);
              }
            } catch (err) {
              console.warn(`Error closing MCP client for ${key}:`, err);
            }
            mcpClients.delete(key);
          }

          console.log(`Cleaned up all resources for ${key}`);
        }
      }

      logStats();
    });
  });

  console.log("Socket.IO server ready");
  return io;
}

export function emitToUserAtRoot(rootId, username, event, data) {
  if (!io) return;
  const key = `${rootId}:${username}`;
  const socketId = userSockets.get(key);
  if (socketId) {
    io.to(socketId).emit(event, data);
  } else {
    console.log(`No socket found for ${key}`);
  }
}

export function emitBroadcast(event, data) {
  if (io) io.emit(event, data);
}

function logStats() {
  console.log(
    `Connections — Sockets: ${userSockets.size}, MCP Clients: ${mcpClients.size}, Conversations: ${conversations.size}`
  );
}
