import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLACE_TARGET = process.env.PORTAL_LAND_TARGET || "http://localhost:3000";

export default defineConfig({
  server: {
    port: 5176,
    proxy: {
      "/api":         { target: PLACE_TARGET, changeOrigin: true },
      "/.well-known": { target: PLACE_TARGET, changeOrigin: true },
      "/socket.io":   { target: PLACE_TARGET, changeOrigin: true, ws: true },
    },
  },
  resolve: {
    alias: {
      "@ibp-address": path.resolve(__dirname, "../../place/seed/addressing/address.js"),
    },
  },
});
