const express = require("express");
const cors = require("cors");
const http = require("http"); // Change https to http
const fs = require("fs");
const cookieParser = require("cookie-parser");
const { connectToMCP } = require("./controllers/mcp/client");

require("dotenv").config();
require("./db/config"); // Initialize DB connection
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

// Routes
app.use("/", require("./routes/ai"));
app.use("/", require("./routes/contributions"));
app.use("/", require("./routes/invites"));
app.use("/", require("./routes/treeManagement"));
app.use("/", require("./routes/notes"));
app.use("/", require("./routes/schedules"));
app.use("/", require("./routes/transactions"));
app.use("/", require("./routes/treeDataFetching"));
app.use("/", require("./routes/users"));
app.use("/", require("./routes/values"));
app.use("/", require("./routes/statuses"));
app.use("/", require("./routes/scripts"));

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
