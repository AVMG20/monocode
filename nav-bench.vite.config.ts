import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Production React with the profiler enabled and component names kept, so
// the navigation benchmark can attribute commits to components.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  esbuild: { keepNames: true },
  resolve: {
    alias: [{ find: "react-dom/client", replacement: "react-dom/profiling" }],
  },
  logLevel: "warn",
  build: {
    outDir: "dist-navbench",
    emptyOutDir: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 100000,
    rollupOptions: { input: { bench: "tests/browser/nav-bench.html" } },
  },
});
