import { Server } from "socket.io";

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

    // Expect client to send identification info right after connecting
    socket.on("register", ({ rootId, username }) => {
      if (!rootId || !username) return;
      const key = `${rootId}:${username}`;
      userSockets.set(key, socket.id);
      console.log(`Registered socket for ${key}`);
    });

    socket.on("disconnect", () => {
      // Clean up any mapping that pointed to this socket.id
      for (const [key, id] of userSockets.entries()) {
        if (id === socket.id) userSockets.delete(key);
      }
      console.log("Client disconnected:", socket.id);
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

//create emit to Root for group trees

export function emitBroadcast(event, data) {
  if (io) io.emit(event, data);
}
