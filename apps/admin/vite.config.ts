import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
