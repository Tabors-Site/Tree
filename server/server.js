const express = require("express");
const cors = require("cors");
const https = require("https");
const fs = require("fs");

require('dotenv').config();
require("./db/config"); // Initialize DB connection

const app = express();
// Middleware
app.use(cors({
  origin: process.env.WEBSITE_URL, 
  methods: ['GET', 'POST', 'OPTIONS'],   
  allowedHeaders: ['Content-Type', 'Authorization'],  
  credentials: true,             
}));
app.options('*', cors());
app.use(express.static("public"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));


// Routes
app.use("/", require("./routes/ai"));
app.use("/", require("./routes/contributions"));
app.use("/", require("./routes/invites"));
app.use("/", require("./routes/treeManagement"));
app.use("/", require("./routes/notes"));
app.use("/", require("./routes/schedules"));
app.use("/", require("./routes/statuses"));
app.use("/", require("./routes/transactions"));
app.use("/", require("./routes/treeDataFetching"));
app.use("/", require("./routes/users"));
app.use("/", require("./routes/values"));

const credentials = {
  key: fs.readFileSync("./serverkeys/voteonsol.com-key.pem", "utf8"),
  cert: fs.readFileSync("./serverkeys/voteonsol.com-crt.pem", "utf8"),
};

const server = https.createServer(credentials, app);
const PORT = process.env.PORT || 443;

server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
