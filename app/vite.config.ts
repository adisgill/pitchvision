import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site at /pitchvision/
export default defineConfig({
  base: "/pitchvision/",
  plugins: [react()],
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
