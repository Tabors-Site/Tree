// ws/server.js
import { Server } from "socket.io";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

let io;

/**
 * key = userId
 * value = socketId
 */
const sessions = new Map();

export function initWebSocketServer(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    transports: ["websocket"],
  });

  /**
   * 🔐 Authenticate socket using cookie
   */
  io.use((socket, next) => {
    const cookie = socket.request.headers.cookie;
    console.log("🍪 incoming cookie:", cookie);

    if (!cookie) {
      console.error("❌ No cookie on socket");
      return next(new Error("No auth cookie"));
    }

    try {
      const match = cookie.match(/token=([^;]+)/);
      const decoded = jwt.verify(match[1], JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (e) {
      console.error("❌ JWT error:", e.message);
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    console.log("🔌 App connected:", socket.id, "user:", userId);

    // Replace any existing session for this user
    const oldSocketId = sessions.get(userId);
    if (oldSocketId && oldSocketId !== socket.id) {
      io.sockets.sockets.get(oldSocketId)?.disconnect(true);
    }

    sessions.set(userId, socket.id);

    socket.on("ready", () => {
      console.log("🧠 iframe ready:", userId);
    });

    socket.on("disconnect", () => {
      if (sessions.get(userId) === socket.id) {
        sessions.delete(userId);
        console.log("🧹 Removed session:", userId);
      }
    });
  });

  console.log("🚀 WS server ready (auth-based)");
  return io;
}

/* ------------------------------------------------------------------ */
/* PUBLIC API (CALLED BY MCP SERVER) */
/* ------------------------------------------------------------------ */

export function emitNavigate({ userId, url, replace = false }) {
  if (!io) return;

  const socketId = sessions.get(userId);
  if (!socketId) {
    console.warn("⚠️ No active app for user:", userId);
    return;
  }

  io.to(socketId).emit("navigate", { url, replace });
}

export function emitReload({ userId }) {
  if (!io) return;

  const socketId = sessions.get(userId);
  if (socketId) {
    io.to(socketId).emit("reload");
  }
}
