import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import registerRoutes from "./routes/routesHandler.js";

import { connectToMCP } from "./mcp/client.js";
import { initWebSocketServer } from "./ws/websocket.js";

import "./db/config.js";

import dotenv from "dotenv";

dotenv.config();

const rootFrontEnd = process.env.ROOT_FRONTEND_DOMAIN;
const treeFrontEnd = process.env.TREE_FRONTEND_DOMAIN;
const beFrontEnd = process.env.BE_FRONTEND_DOMAIN;

const app = express();

app.use(
  cors({
    origin: [rootFrontEnd, treeFrontEnd, beFrontEnd],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(cookieParser());

app.options("*", cors());
app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set("trust proxy", 1);

registerRoutes(app);

const server = http.createServer(app);
initWebSocketServer(server);

const PORT = process.env.PORT || 80; //

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Express server (Tree/MCP coupled) running on port ${PORT}`);

  //connect MCP client to MCP server at initializino
  const MCP_URL = `http://localhost:${PORT}/mcp`;
  try {
    await connectToMCP(MCP_URL);
    console.log("MCP client auto-connect completed successsfully.");
  } catch (err) {
    console.error("Failed to connect to MCP server:", err.message);
  }
});
