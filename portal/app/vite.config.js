import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Land target for the dev proxy. Override at the shell:
//   PORTAL_LAND_TARGET=https://treeos.ai npm run dev
const LAND_TARGET = process.env.PORTAL_LAND_TARGET || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Proxy land-server traffic through Vite so the browser sees same-origin
    // requests. CORS doesn't engage. The Portal client uses relative URLs
    // when in dev mode (see portal-client.js); Vite forwards them here.
    proxy: {
      "/api":         { target: LAND_TARGET, changeOrigin: true },
      "/.well-known": { target: LAND_TARGET, changeOrigin: true },
      "/socket.io":   { target: LAND_TARGET, changeOrigin: true, ws: true },
    },
  },
  resolve: {
    alias: {
      // The Portal Address parser lives one level up at /portal/lib/
      // and is the single source of truth shared with the Land server.
      "@portal-address": path.resolve(__dirname, "../lib/portal-address.js"),
    },
  },
});
