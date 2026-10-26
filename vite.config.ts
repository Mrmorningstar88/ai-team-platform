import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client is a static SPA served by the Worker's asset binding.
// In dev, /api requests go to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client" },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
