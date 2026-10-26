import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const target = `http://127.0.0.1:${env.PORT || 8766}`;
  return {
    server: { proxy: { "/rpc": { target, ws: true }, "/healthz": { target } } },
    build: {
      assetsInlineLimit: Infinity,
      rollupOptions: {
        output: {
          entryFileNames: "app.js",
          chunkFileNames: "[name].js",
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith(".css"))
              ? "style.css"
              : "[name][extname]",
        },
      },
    },
  };
});
