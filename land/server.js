import express from "express";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import registerRoutes from "./routes/app/routesHandler.js";
import registerURLRoutes from "./routes/routeHandler.js";
import { initWebSocketServer } from "./ws/websocket.js";
import { notFoundPage } from "./middleware/notFoundPage.js";
import securityHeaders from "./middleware/securityHeaders.js";
import { stripeWebhook } from "./routes/billing/webhook.js";
import { onListen } from "./startup.js";
import { getLandUrl } from "./canopy/identity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();

app.use(
  cors({
    origin: [getLandUrl()],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(cookieParser());
app.post("/billing/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.options("*", cors());
app.use(express.static("public"));
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);

registerRoutes(app);
await registerURLRoutes(app);
app.use((req, res) => notFoundPage(req, res));

const server = http.createServer(app);
export const wsServer = initWebSocketServer(server);

const PORT = process.env.PORT || 80;
server.listen(PORT, "0.0.0.0", () => onListen());
