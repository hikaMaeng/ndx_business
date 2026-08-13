import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { admin_domain: path.resolve(__dirname, "../../packages/admin_domain/src") } },
  root: "src/front",
  build: {
    outDir: "../../dist/front",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:18080"
    }
  }
});
