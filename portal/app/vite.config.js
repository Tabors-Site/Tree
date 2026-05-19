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
      // The IBP Address parser is the substrate's addressing grammar
      // and lives in the Land seed as the single source of truth.
      // Portal consumes it via this alias.
      "@ibp-address": path.resolve(__dirname, "../../land/seed/addressing/address.js"),
    },
  },
});
