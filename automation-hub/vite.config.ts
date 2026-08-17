import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    port: 5421,
    proxy: { "/api": "http://127.0.0.1:5420", "/auth": "http://127.0.0.1:5420" },
  },
});
