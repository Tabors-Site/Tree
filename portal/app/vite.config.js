import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
  },
  resolve: {
    alias: {
      // The Portal Address parser lives one level up at /portal/lib/
      // and is the single source of truth shared with the Land server.
      "@portal-address": path.resolve(__dirname, "../lib/portal-address.js"),
    },
  },
});
