import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// changeOrigin must stay false: the loopback backend checks the browser Origin
// against the preserved Host, mirroring the platform gateway's same-origin rule.
const proxy = {
  "/functions/v1/app": { target: "http://127.0.0.1:8000", changeOrigin: false },
  "/storage/v1": { target: "http://127.0.0.1:8000", changeOrigin: false },
};

export default defineConfig({
  base: "/jojo-admin-dashboard/",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: { outDir: "dist" },
});
