/**
 * Bootstrap SOLO para los tests que, de forma transitiva, importan módulos de `src/server/**`.
 *
 * Desde la fase 5 (R2), `src/server/data-dir.ts` lee `DATADB_DATA_DIR` al cargarse y falla fuerte si no está definida
 * (en producción la publica `main` al forkar el worker). Los tests no arrancan Electron, así que aquí se fija el
 * override a un directorio temporal ANTES de que se evalúe cualquier módulo de `src/server`. Además de evitar que el
 * import reviente, garantiza que estos tests NUNCA toquen el `data/` real del usuario (perfiles con credenciales de
 * producción).
 *
 * Se importa como PRIMERA línea de los test files afectados, porque en la salida CJS de tsx los `import` son
 * `require`s hoisted y el orden de evaluación es el del código fuente.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DATADB_DATA_DIR) {
  process.env.DATADB_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "datadb-test-"));
}
