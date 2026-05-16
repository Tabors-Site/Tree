import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAND_TARGET = process.env.PORTAL_LAND_TARGET || "http://localhost:3000";

export default defineConfig({
  server: {
    port: 5176,
    proxy: {
      "/api":         { target: LAND_TARGET, changeOrigin: true },
      "/.well-known": { target: LAND_TARGET, changeOrigin: true },
      "/socket.io":   { target: LAND_TARGET, changeOrigin: true, ws: true },
    },
  },
  resolve: {
    alias: {
      "@portal-address": path.resolve(__dirname, "../lib/portal-address.js"),
    },
  },
});
