/**
 * Build de escritorio: tres entradas (main, preload, renderer).
 * Convive con Next.js hasta la fase 4; `npm run dev:web` sigue arrancando la web.
 *
 * Tailwind v4 se compila por PostCSS (postcss.config.mjs), que Vite respeta tal cual:
 * es la ruta que ya funcionaba en el repo, asi que no se agrega @tailwindcss/vite.
 */
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

export default defineConfig({
  main: {
    // pg / mysql2 / mssql quedan fuera del bundle (modulos nativos / CJS).
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        // Dos entradas: la ventana (main) y el utilityProcess de base de datos (db-worker).
        // Salen como out/main/main.js y out/main/db-worker.js (se nombran por la clave).
        input: {
          main: path.resolve(__dirname, "electron/main.ts"),
          "db-worker": path.resolve(__dirname, "electron/db-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // El preload importa src/shared/contract (solo arrays de strings; los tipos se borran).
    resolve: { alias },
    build: { lib: { entry: path.resolve(__dirname, "electron/preload.ts") } },
  },
  renderer: {
    root: ".",
    plugins: [react()],
    resolve: { alias },
    build: {
      rollupOptions: { input: path.resolve(__dirname, "index.html") },
    },
  },
});
