/**
 * R28 (fase 25, D10): el SQL que genera la IA NUNCA se ejecuta sin que el usuario lo ejecute él mismo.
 *
 * Hoy los 6 puntos de entrada (chat «Insertar», texto→SQL «Insertar/Reemplazar», corregir error, corregir lint,
 * convertir dialecto, preguntas sobre filas) solo ponen texto en el editor; el usuario decide después si pulsa Ejecutar
 * (como el AI Assistant de DataGrip: «Insert at caret», nunca «Run»). Este test es ESTRUCTURAL: lee el código fuente y
 * falla si algún camino de IA gana acceso a la ejecución. Es deliberadamente estricto: si en el futuro se quiere un
 * «Ejecutar» desde la IA, tiene que ser un cambio consciente (con confirmación explícita, `.hermes.md`) que edite este
 * test, no un efecto colateral.
 *
 * Qué cubre:
 *  1. Ningún archivo de IA (todos los `src/components/ai-*.tsx` presentes y futuros, `explain-tab.tsx`, `src/lib/ai.ts`,
 *     `src/server/handlers/ai.ts`, `src/server/ai/*.ts`) menciona funciones, canales o eventos de ejecución.
 *  2. Los archivos de IA del renderer solo importan de `@/lib/api` lo que no ejecuta (`explainQuery`: EXPLAIN sin
 *     ANALYZE, ver 4).
 *  3. En `sql-editor.tsx`, los receptores del SQL de IA (`handleInsertAiSql`, `handleReplaceAiSql`, el oyente de
 *     `gestordb:ai-insert-sql` y TODAS las props `onInsert`/`onReplace` que se pasan a los componentes de IA) solo
 *     editan el documento: no llaman a `handleRun`, `executeStatements` ni disparan `cm-run-query`.
 *  4. El EXPLAIN de los drivers no lleva ANALYZE (con ANALYZE, explicar un DELETE lo ejecutaría).
 *
 * Verificado al escribirlo: añadir `handleRun("active")` dentro de `handleInsertAiSql` hace fallar el caso 3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Todo lo que significa «ejecutar contra la base». */
const EXECUTION_MARKERS = [
  /\brunQuery\b/,
  /\bexecuteStatements\b/,
  /\bhandleRun\b/,
  /\bexecuteQuery\b/,
  /\bbatchEdit\b/,
  /\b(begin|commit|rollback)Transaction\b/,
  /cm-run-query/,
  /RUN_QUERY_EVENT/,
  /["']query:execute["']/,
  /["']grid:batchEdit["']/,
  /["']tx:(begin|commit|rollback)["']/,
  /\.driver\./,
];

function aiFiles(): string[] {
  const comps = readdirSync(path.join(ROOT, "src/components"))
    .filter((f) => /^ai-.*\.tsx$/.test(f))
    .map((f) => `src/components/${f}`);
  const server = readdirSync(path.join(ROOT, "src/server/ai"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `src/server/ai/${f}`);
  return [...comps, "src/components/explain-tab.tsx", "src/lib/ai.ts", "src/server/handlers/ai.ts", ...server];
}

/** Quita comentarios para que la documentación («nunca llama a runQuery») no dé falsos positivos. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Texto del bloque balanceado que empieza en el primer `open` a partir de `from`. */
function balanced(src: string, from: number, open = "{", close = "}"): string {
  const start = src.indexOf(open, from);
  assert.ok(start >= 0, "no se encontró el bloque");
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("bloque sin cerrar");
}

function assertNoExecution(code: string, where: string) {
  for (const marker of EXECUTION_MARKERS) {
    assert.ok(!marker.test(code), `R28: ${where} contiene ${marker} (un camino de IA no puede ejecutar SQL)`);
  }
}

test("R28: ningún archivo de IA toca la ejecución", () => {
  const files = aiFiles();
  // Si alguien renombra la carpeta o los archivos, el test no debe quedarse vacío en silencio.
  assert.ok(files.length >= 12, `se esperaban ≥12 archivos de IA, hay ${files.length}`);
  for (const f of files) assertNoExecution(stripComments(read(f)), f);
});

test("R28: la IA del renderer solo importa de @/lib/api lo que no ejecuta", () => {
  const ALLOWED = new Set(["explainQuery"]);
  for (const f of aiFiles().filter((x) => x.startsWith("src/components/") || x === "src/lib/ai.ts")) {
    const src = read(f);
    for (const m of src.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*["']@\/lib\/api["']/g)) {
      if (m[1]) continue; // solo tipos
      const names = m[2].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const bad = names.filter((n) => !ALLOWED.has(n));
      assert.deepEqual(bad, [], `R28: ${f} importa ${bad.join(", ")} de @/lib/api`);
    }
    assert.ok(!/import\s+\*\s+as\s+\w+\s+from\s+["']@\/lib\/api["']/.test(src), `R28: ${f} importa todo @/lib/api`);
    // `invoke` directo: solo canales de IA, de secretos y el EXPLAIN (sin ANALYZE). Cualquier otro canal se revisa.
    for (const m of src.matchAll(/\binvoke\(\s*["'`]([^"'`]+)["'`]/g)) {
      assert.ok(/^(ai|aiChats|secrets):|^query:explain$/.test(m[1]), `R28: ${f} invoca el canal «${m[1]}»`);
    }
    assert.ok(!/\binvoke\(\s*[^"'`\s]/.test(src), `R28: ${f} invoca un canal calculado (no se puede revisar)`);
  }
});

test("R28: en el editor, el SQL de la IA solo se inserta o reemplaza", () => {
  const src = stripComments(read("src/components/sql-editor.tsx"));
  const receivers: [string, string][] = [];
  for (const name of ["handleInsertAiSql", "handleReplaceAiSql"]) {
    const at = src.indexOf(`const ${name} = React.useCallback(`);
    assert.ok(at >= 0, `no se encontró ${name} en sql-editor.tsx`);
    receivers.push([name, balanced(src, at, "(", ")")]);
  }
  const listener = src.indexOf("function onInsertSql(");
  assert.ok(listener >= 0, "no se encontró el oyente de gestordb:ai-insert-sql");
  receivers.push(["onInsertSql", balanced(src, listener)]);
  // Todas las props que entregan SQL de IA al editor, incluidas las lambdas en línea.
  const props = [...src.matchAll(/\bon(Insert|Replace)=\{/g)];
  assert.ok(props.length >= 6, `se esperaban ≥6 props onInsert/onReplace, hay ${props.length}`);
  for (const p of props) receivers.push([`prop ${p[0]} @${p.index}`, balanced(src, p.index!)]);
  for (const [name, body] of receivers) assertNoExecution(body, `sql-editor.tsx › ${name}`);
});

test("R28: EXPLAIN de los drivers sin ANALYZE (explicar no ejecuta)", () => {
  for (const f of ["src/server/db/postgres.ts", "src/server/db/mysql.ts", "src/server/db/sqlserver.ts"]) {
    const src = stripComments(read(f));
    const at = src.indexOf("async explainQuery(");
    assert.ok(at >= 0, `no se encontró explainQuery en ${f}`);
    assert.ok(!/ANALYZE/i.test(balanced(src, at)), `R28: ${f} usa EXPLAIN ANALYZE`);
  }
});
