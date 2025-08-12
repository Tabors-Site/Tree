const express = require("express");
const cors = require("cors");
const http = require("http"); // Change https to http
const fs = require("fs");

require("dotenv").config();
require("./db/config"); // Initialize DB connection

const app = express();
// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      const baseUrl = process.env.BASE_URL; // e.g. "tabors.site"

      if (!baseUrl) {
        return callback(new Error("BASE_URL not configured in env"));
      }

      // Allow requests with no origin (like curl, postman, server-to-server)
      if (!origin) return callback(null, true);

      const allowedBase = `.${baseUrl}`;
      if (
        origin === `http://${baseUrl}` ||
        (origin.endsWith(allowedBase) && origin.startsWith("http://"))
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.options("*", cors());
app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set('trust proxy', 1);

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

const server = http.createServer(app); // Use http.createServer instead of https.createServer
const PORT = process.env.PORT || 80; // Default HTTP port is 80

server.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`)
);
