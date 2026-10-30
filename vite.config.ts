import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 静态站点（GitHub Pages）部署在仓库子路径下，需要用 VITE_BASE 覆盖资源前缀。
// 本地开发与 `npm start`（同源网关）保持默认 "/"。
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
