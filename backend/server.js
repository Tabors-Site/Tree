import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import registerRoutes from "./routes/routesHandler.js";
import registerURLRoutes from "./routesURL/routeURLHandler.js";

import { initWebSocketServer } from "./ws/websocket.js";

import "./db/config.js"; // Initialize DB connection

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
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set("trust proxy", 1);

registerRoutes(app);
registerURLRoutes(app);

const server = http.createServer(app);
initWebSocketServer(server, [rootFrontEnd, treeFrontEnd, beFrontEnd]);

const PORT = process.env.PORT || 80; //

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Express server (Tree/MCP coupled) running on port ${PORT}`);
});
