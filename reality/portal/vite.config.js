import { defineConfig } from "vite";

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
});
