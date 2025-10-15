import express from 'express';
import cors from 'cors';
import http from 'http'; // Change https to http
import cookieParser from 'cookie-parser';
import { connectToMCP } from './controllers/mcp/client.js';


import aiRoutes from "./routes/ai.js";
import contributionsRoutes from "./routes/contributions.js";
import invitesRoutes from "./routes/invites.js";
import treeManagementRoutes from "./routes/treeManagement.js";
import notesRoutes from "./routes/notes.js";
import schedulesRoutes from "./routes/schedules.js";
import transactionsRoutes from "./routes/transactions.js";
import treeDataFetchingRoutes from "./routes/treeDataFetching.js";
import usersRoutes from "./routes/users.js";
import valuesRoutes from "./routes/values.js";
import statusesRoutes from "./routes/statuses.js";
import scriptsRoutes from "./routes/scripts.js";

import dotenv from "dotenv";

dotenv.config();

import './db/config.js'; // Initialize DB connection
const rootFrontEnd = process.env.ROOT_FRONTEND_DOMAIN;
const treeFrontEnd = process.env.TREE_FRONTEND_DOMAIN;
const beFrontEnd = process.env.BE_FRONTEND_DOMAIN;
const app = express();

// Middleware
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



app.use("/", aiRoutes);
app.use("/", contributionsRoutes);
app.use("/", invitesRoutes);
app.use("/", treeManagementRoutes);
app.use("/", notesRoutes);
app.use("/", schedulesRoutes);
app.use("/", transactionsRoutes);
app.use("/", treeDataFetchingRoutes);
app.use("/", usersRoutes);
app.use("/", valuesRoutes);
app.use("/", statusesRoutes);
app.use("/", scriptsRoutes);

const server = http.createServer(app);
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
