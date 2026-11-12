# Guía para agentes — DataDB Desktop

> Nota histórica: el producto se llamó **GestorDB** hasta la fase 5; desde entonces se llama
> **DataDB**.

Cliente de bases de datos para macOS. Electron + Vite (electron-vite) + React 19 + TypeScript +
Tailwind v4 + CodeMirror 6.

## Comandos

- `npm install` — instala dependencias.
- `npm run dev` — arranca la app (`electron-vite dev`; abre la ventana).
- `npm run lint && npm run build` — verificación obligatoria. `build` compila el bundle de
  Electron con `electron-vite build`; `build:desktop` es un alias del mismo comando.
- `npm test` — `tsx --test` sobre `src/**/*.test.ts` y `electron/**/*.test.ts`.
- `npm run typecheck` — comprobación de tipos (`tsc --noEmit`; electron-vite no corre `tsc`).

## Estructura

```
electron/        Proceso main + preload + utilityProcess de base de datos
  main.ts          ventana, broker renderer↔worker, cifrado de secretos (safeStorage)
  preload.ts       superficie IPC acotada expuesta al renderer
  db-worker.ts     utilityProcess que aloja sesiones, pools y drivers
  broker.ts        correlación de peticiones/respuestas con el worker
src/
  renderer/      entrada del renderer (main.tsx, globals.css, fonts.css)
  components/    componentes React de la UI
  server/        lógica del worker: drivers de BD, handlers IPC, IA, perfiles
  theme/         sistema de temas (tokens, store)
index.html       entrada de Vite
```

Flujo: `renderer --invoke--> main (valida) --postMessage--> db-worker --> drivers`. `main` no
toca ninguna base de datos.

## Reglas del repo

Las reglas completas de alcance, verificación, estilo y seguridad viven en `.hermes.md`; el
alcance y el detalle por fase viven en `.planning/` (leer `STATE.md` y el `PLAN.md` de la fase
actual antes de implementar). En resumen:

- Si algo no está en `.planning/REQUIREMENTS.md`, no se implementa.
- Ninguna credencial en texto plano en disco, logs ni en el payload al LLM.
- El SQL generado por IA nunca se ejecuta sin confirmación explícita.
- `git push` solo con confirmación previa del usuario.
- Reportar el trabajo con: qué cambió, cómo se verificó, qué falta. Sin narrar el proceso.
