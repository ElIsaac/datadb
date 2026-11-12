/**
 * Config de ESLint del repo (fase 4, T2 / D5).
 *
 * Antes esto era `eslint-config-next` entero (`core-web-vitals` + `typescript`). Al borrar
 * Next.js esa dependencia desaparece, y con ella TODAS las reglas: un `npm run lint` en verde
 * no significaria nada. Este archivo lo reemplaza con el equivalente real para una SPA de
 * Vite + React + TypeScript:
 *
 *   - `@eslint/js` recommended  -> errores de JavaScript que TypeScript no caza por si solo.
 *   - `typescript-eslint` recommended (SIN type-checking) -> reglas de TS. Se deja sin
 *     `recommendedTypeChecked` a proposito: exige un programa de tipos completo en cada corrida
 *     y multiplica el tiempo de lint; el chequeo de tipos de verdad ya lo hace `npm run typecheck`
 *     (`tsc --noEmit`), que corre en la verificacion de cada fase.
 *   - `eslint-plugin-react-hooks` -> reglas de hooks (dependencias de useEffect, hooks dentro de
 *     condicionales). Es lo unico de `eslint-config-next` que de verdad se usaba aqui a diario.
 *
 * Se PROBO tambien `eslint-plugin-react-refresh` (avisa cuando un modulo exporta cosas que rompen
 * el Fast Refresh de Vite) y se DESCARTO con la medida delante: dejaba 11 avisos permanentes en 4
 * archivos que estan asi a proposito (las variantes `cva` de shadcn en button/badge, los
 * componentes auxiliares de sql-code-editor y el par provider+hook de use-app-state), y ninguno se
 * puede quitar sin un refactor de UI ajeno a esta fase. Once avisos fijos en cada corrida esconden
 * el aviso nuevo que si importa, asi que el lint se queda sin la regla en vez de con ruido.
 *
 * Lo que se PIERDE respecto a `eslint-config-next`, consciente y registrado en el PLAN de la
 * fase 4 (D5): las reglas `@next/next/*` (no aplican: no hay Next), `jsx-a11y` y `import`.
 * Si se echan de menos se reinstalan como plugins sueltos; no habia regla de esas dos familias
 * fallando hoy, asi que no se arrastran "por si acaso".
 *
 * Ojo con las versiones: `@eslint/js` va fijado a ^9 porque el 10.x pide `eslint ^10` y aqui
 * hay `eslint@9` (ERESOLVE real, no se resuelve con --legacy-peer-deps).
 */
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  // `out/` es la salida de electron-vite (main, preload y renderer compilados) y `dist/` la de
  // un empaquetado futuro (fase 28). `data/` son datos locales del usuario (conexiones, historial).
  // `.worktrees/` son los git worktrees de las tarjetas del kanban.
  globalIgnores([
    "out/**",
    "dist/**",
    // Salida de `electron-builder` (fase 28): el .app empaquetado son 400 MB con Copia de
    // node_modules dentro; sin esto ESLint recorre el bundle entero y tarda minutos en fallar.
    "release/**",
    "node_modules/**",
    "data/**",
    "design/**",
    ".worktrees/**",
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  // Ojo con la forma: en eslint-plugin-react-hooks 7.x los configs de `configs.recommended` /
  // `configs["recommended-latest"]` siguen siendo del formato VIEJO (`plugins` como array de
  // strings) y ESLint 9 los rechaza. Los de flat config viven bajo `configs.flat`.
  reactHooks.configs.flat["recommended-latest"],

  // El renderer corre en el contexto de la ventana: globals de navegador.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  // `main`, el preload, el utilityProcess de base de datos, los scripts de build y los configs
  // sueltos corren en Node.
  {
    // `scripts/**/*.mjs`: las sondas en JS plano también son Node.
    files: ["electron/**/*.ts", "scripts/**/*.{ts,mjs}", "src/server/**/*.ts", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
]);
