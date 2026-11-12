/**
 * Importa los iconos de IntelliJ (fase 8, T1; R34) desde un commit FIJADO de JetBrains/intellij-community.
 *
 *   npm run icons:import                  # descarga de raw.githubusercontent.com (commit de icons.json)
 *   npm run icons:import -- --from <dir>  # usa un clon local del repo (mismo commit; sin red)
 *
 * Lee src/icons/intellij/icons.json (nombre lógico → ruta dentro de `expui/`) y escribe:
 *   - src/icons/intellij/generated.ts  SVG con colores `var(--gdb-ic*)` (D3), sin cabecera; NO editar a mano.
 *   - src/icons/intellij/MANIFEST.md   procedencia por icono: ruta, commit, cabecera de licencia, sha256 de los dos
 *                                      originales, tokens usados y colores normalizados. Incluye además la sección de
 *                                      los iconos propios de GestorDB (origen: propio, T5), que no se descargan.
 *   - src/icons/intellij/NOTICE.txt y LICENSE-APACHE-2.0.txt  (Apache 2.0 §4: conservar licencia y NOTICE).
 *
 * Aborta sin escribir nada si algún icono no cumple (sin cabecera Apache, dibujos distintos, par de color
 * desconocido): la regla de R34 se aplica aquí, no en la revisión. La app nunca descarga iconos en ejecución (R3).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { colorize, licenseHeader } from "../src/icons/intellij/import-lib";
import { CUSTOM_ICONS, CUSTOM_ICON_ORIGIN } from "../src/icons/custom/custom-icons";

const OUT = path.resolve(__dirname, "../src/icons/intellij");
const cfg = JSON.parse(readFileSync(path.join(OUT, "icons.json"), "utf8")) as {
  repo: string;
  commit: string;
  root: string;
  icons: Record<string, string>;
};
const fromIdx = process.argv.indexOf("--from");
const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

async function read(rel: string): Promise<string> {
  if (fromDir) return readFileSync(path.join(fromDir, rel), "utf8");
  const url = `https://raw.githubusercontent.com/${cfg.repo}/${cfg.commit}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const out: { name: string; rel: string; svg: string; header: string; shaL: string; shaD: string; tokens: string[]; normalized: string[] }[] = [];
  const errors: string[] = [];
  for (const [name, rel] of Object.entries(cfg.icons)) {
    const base = `${cfg.root}/${rel}`;
    try {
      const [l, d] = await Promise.all([read(`${base}.svg`), read(`${base}_dark.svg`)]);
      const r = colorize(name, l, d);
      out.push({ name, rel, svg: r.svg, header: licenseHeader(l)!, shaL: sha(l), shaD: sha(d), tokens: r.tokens, normalized: r.normalized });
    } catch (e) {
      errors.push(`  ${rel}: ${(e as Error).message}`);
    }
  }
  if (errors.length) {
    console.error(`Importación abortada (${errors.length} icono(s)); no se escribió nada:\n${errors.join("\n")}`);
    process.exit(1);
  }

  const ts = [
    "// GENERADO por scripts/import-intellij-icons.ts — no editar a mano (npm run icons:import).",
    `// Origen: ${cfg.repo} @ ${cfg.commit}, ${cfg.root}/. Licencia Apache 2.0 (cabecera de cada SVG en MANIFEST.md;`,
    "// texto en LICENSE-APACHE-2.0.txt y NOTICE.txt de esta carpeta). Los colores son tokens de la paleta (fase 8, D3).",
    "export const IJ_ICONS = {",
    ...out.map((i) => `  ${i.name}: ${JSON.stringify(i.svg)},`),
    "} as const;",
    "",
    "export type IjIconName = keyof typeof IJ_ICONS;",
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "generated.ts"), ts);

  const md = [
    "# Iconos de IntelliJ — procedencia (R34)",
    "",
    "Generado por `scripts/import-intellij-icons.ts`; no editar a mano.",
    "",
    `- Repositorio: \`${cfg.repo}\`, commit \`${cfg.commit}\`, carpeta \`${cfg.root}/\`.`,
    "- Licencia: Apache 2.0, comprobada en la **cabecera de cada SVG** (el `LICENSE.txt` raíz del repo ya no es el texto",
    "  de Apache sino los términos de los binarios). Texto completo en `LICENSE-APACHE-2.0.txt`; `NOTICE.txt` del repo copiado.",
    "- Modificaciones (Apache 2.0 §4b): se quita la cabecera del SVG en línea, se fusionan las variantes clara y oscura en",
    "  una geometría con los colores como variables CSS `--gdb-ic*` y se prefijan los ids internos.",
    "",
    "| Nombre | Ruta | Cabecera | sha256 claro | sha256 oscuro | Tokens | Normalizados |",
    "|---|---|---|---|---|---|---|",
    ...out.map(
      (i) =>
        `| \`${i.name}\` | \`${i.rel}\` | ${i.header} | \`${i.shaL.slice(0, 16)}\` | \`${i.shaD.slice(0, 16)}\` | ${i.tokens.join(", ")} | ${i.normalized.join(", ") || "—"} |`
    ),
    "",
    "## Iconos propios (origen: propio) — T5, decisión D1",
    "",
    "Dibujados para GestorDB con la gramática de `expui` (viewBox 16, trazo de 1 px, colores SOLO vía tokens `--gdb-ic*`).",
    "**No** proceden de JetBrains: no tienen cabecera Apache 2.0 ni sha256 de origen; su licencia es la del proyecto",
    "(cabecera en `src/icons/custom/custom-icons.ts`). Existen porque el set abierto no trae los objetos de base de datos",
    "(son del plugin Database cerrado de DataGrip) ni los de IA (sus SVG no llevan cabecera Apache 2.0).",
    "",
    "| Nombre | Origen | Motivo |",
    "|---|---|---|",
    ...Object.keys(CUSTOM_ICONS).map((name) => `| \`${name}\` | propio | ${CUSTOM_ICON_ORIGIN[name as keyof typeof CUSTOM_ICONS]} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, "MANIFEST.md"), md);

  writeFileSync(path.join(OUT, "NOTICE.txt"), await read("NOTICE.txt"));
  const lic = path.join(OUT, "LICENSE-APACHE-2.0.txt");
  if (!existsSync(lic)) {
    const res = await fetch("https://www.apache.org/licenses/LICENSE-2.0.txt");
    if (!res.ok) throw new Error(`LICENSE-2.0.txt: HTTP ${res.status}`);
    writeFileSync(lic, await res.text());
  }
  const norm = out.filter((i) => i.normalized.length);
  console.log(`ok ${out.length} iconos → ${path.relative(process.cwd(), OUT)}/generated.ts`);
  if (norm.length) console.log(`normalizados: ${norm.map((i) => `${i.name} (${i.normalized.join(", ")})`).join("; ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
