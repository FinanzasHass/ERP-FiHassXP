import { defineConfig } from "vite";
export default defineConfig({
  root: "src/client",
  envDir: false,
  envPrefix: "PUBLIC_CLIENT_",
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        headers: { Origin: "http://localhost:3000" },
      },
    },
  },
  build: { outDir: "../../dist/client", emptyOutDir: true, sourcemap: false },
});
