import { resolve } from "node:path";
import { defineConfig } from "vite";

const PLACE_TARGET = process.env.PORTAL_LAND_TARGET || "http://localhost:3000";

export default defineConfig({
  build: {
    rollupOptions: {
      // Two entries, one portal. index.html boots with the 3D view as
      // default; text.html boots text-first and never loads Three.js
      // (the 3D view module is lazy — see core/views.js).
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        text: resolve(import.meta.dirname, "text.html"),
      },
    },
  },
  server: {
    port: 5176,
    proxy: {
      "/api":         { target: PLACE_TARGET, changeOrigin: true },
      "/.well-known": { target: PLACE_TARGET, changeOrigin: true },
      "/socket.io":   { target: PLACE_TARGET, changeOrigin: true, ws: true },
    },
  },
});
