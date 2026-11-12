/**
 * Regla de la fase 8 (T6 a; R34): el chrome y el árbol no usan `lucide-react`. Los 11 iconos que no existían en el
 * set abierto de JetBrains se dibujaron propios en T5 (src/icons/custom/custom-icons.ts) y ya no queda ningún
 * import de lucide en estos archivos: la lista PENDIENTES quedó vacía a propósito, y volverá a llenarse si alguien
 * introduce uno.
 *
 * Fuera del alcance de R34 (siguen con lucide a propósito): diálogos de IA, diagrama ER, exportador y components/ui/*.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ALCANCE = [
  // Fase 9 (T2): right-panel e history-drawer desaparecieron (sus contenidos viven ahora en los docks de
  // tool windows); entran los componentes nuevos del chrome.
  "app-shell", "schema-tree", "tab-bar", "status-bar", "console-connection-bar", "sql-editor", "result-tabs-panel",
  "results-grid", "query-history", "saved-queries", "connection-screen",
  "tool-window-bar", "tool-window", "column-icon",
];

/** Vacía desde T5 (2026-10-09): todos los iconos del alcance son de IntelliJ o propios. */
const PENDIENTES: Record<string, string> = {};

test("R34: en el chrome y el árbol no queda ningún import de lucide-react", () => {
  const offenders: string[] = [];
  for (const name of ALCANCE) {
    const code = readFileSync(path.resolve(__dirname, "../components", `${name}.tsx`), "utf-8");
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)) {
      for (const icon of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!(icon in PENDIENTES)) offenders.push(`${name}.tsx: ${icon}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `Usar <IjIcon> (src/components/ij-icon.tsx):\n${offenders.join("\n")}`);
});
