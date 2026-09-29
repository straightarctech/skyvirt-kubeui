import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

// Single source of truth for the app version: the repo-root VERSION file,
// overridable by KUBEUI_VERSION (set by the Makefile). Commit is best-effort.
const appVersion =
  process.env.KUBEUI_VERSION ||
  (() => {
    try {
      return fs.readFileSync(path.resolve(__dirname, "../VERSION"), "utf8").trim();
    } catch {
      return "0.0.0-dev";
    }
  })();
const appCommit =
  process.env.KUBEUI_COMMIT ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim();
    } catch {
      return "unknown";
    }
  })();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-recharts": ["recharts"],
          "vendor-console": ["xterm", "xterm-addon-fit"],
        },
      },
    },
  },
});
