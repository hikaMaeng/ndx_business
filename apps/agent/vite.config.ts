import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/front"),
  resolve: { alias: { agent_domain: path.resolve(__dirname, "../../packages/agent_domain/dist") } },
  build: { outDir: path.resolve(__dirname, "dist/front"), emptyOutDir: true },
});
