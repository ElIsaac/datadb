#!/usr/bin/env node
/**
 * Calcula QUÉ paquetes de node_modules necesita la app EMPAQUETADA (fase 28 / R29).
 *
 * Por qué existe: `electron-builder` mete en el .asar todo lo que esté en `dependencies`, y aquí eso
 * son ~40 paquetes de interfaz (React, CodeMirror, lucide…) que NO hacen falta en tiempo de
 * ejecución porque el renderer ya viene empaquetado por Vite dentro de `out/renderer`. El resultado
 * eran 168 MB de asar, la mayoría código muerto.
 *
 * Cómo funciona: parte de los paquetes que `out/main` y `out/preload` piden con `require()` de
 * verdad (se leen del bundle, no de una lista escrita a mano) y cierra la lista siguiendo
 * `dependencies` de cada paquete. Las `optionalDependencies` NO se siguen: los drivers las cargan
 * dentro de try/catch y, si faltan, la app funciona igual.
 *
 * Uso:  node scripts/deps-runtime.mjs           → lista para pegar en electron-builder.yml
 *       node scripts/deps-runtime.mjs --json    → JSON (nombre + tamaño)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { builtinModules } from "node:module";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const salida = join(raiz, "out");

// 1) requires reales del bundle de main/preload (los del renderer no cuentan: va empaquetado).
const peticiones = new Set();
for (const dir of ["main", "preload"]) {
  const carpeta = join(salida, dir);
  if (!existsSync(carpeta)) continue;
  for (const f of readdirSync(carpeta)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(join(carpeta, f), "utf8");
    for (const m of src.matchAll(/require\("([^".][^"]*)"\)/g)) {
      const id = m[1];
      // `electron` lo provee el runtime (no vive en node_modules) y los módulos del núcleo tampoco.
      if (id.startsWith("node:")) continue;
      if (id === "electron" || builtinModules.includes(id)) continue;
      peticiones.add(id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0]);
    }
  }
}

// 2) cierre transitivo por `dependencies`.
const vistos = new Set();
const pila = [...peticiones];
const faltantes = [];
while (pila.length) {
  const nombre = pila.pop();
  if (vistos.has(nombre)) continue;
  const pj = join(raiz, "node_modules", nombre, "package.json");
  if (!existsSync(pj)) {
    faltantes.push(nombre);
    continue;
  }
  vistos.add(nombre);
  const p = JSON.parse(readFileSync(pj, "utf8"));
  const opcionales = new Set(Object.keys(p.optionalDependencies ?? {}));
  for (const dep of Object.keys(p.dependencies ?? {})) {
    if (!opcionales.has(dep)) pila.push(dep);
  }
}

const lista = [...vistos].sort();
const tamano = (n) => {
  try {
    return Number(execSync(`du -sk ${JSON.stringify(join(raiz, "node_modules", n))}`, { encoding: "utf8" }).split("\t")[0]);
  } catch {
    return 0;
  }
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(lista.map((n) => ({ nombre: n, kb: tamano(n) })), null, 2));
} else {
  const total = lista.reduce((a, n) => a + tamano(n), 0);
  console.log(`# ${lista.length} paquetes · ${(total / 1024).toFixed(1)} MB`);
  console.log(`# arranque: ${[...peticiones].sort().join(", ")}`);
  if (faltantes.length) console.error(`# ATENCIÓN: no instalados: ${faltantes.join(", ")}`);
  for (const n of lista) console.log(`  node_modules/${n}/**`);
}
