import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/front"),
  resolve: { alias: { agent: path.resolve(__dirname, "../../packages/agent/dist"), vibeagent_domain: path.resolve(__dirname, "../../packages/vibeagent_domain/dist") } },
  build: { outDir: path.resolve(__dirname, "dist/front"), emptyOutDir: true },
});
