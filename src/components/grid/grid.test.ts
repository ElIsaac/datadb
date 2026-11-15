import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pintarCelda,
  celdaParaCopiar,
  TEXTO_NULO,
  MAX_CARACTERES_EN_CELDA,
  MARCA_RECORTE,
  booleanoParaGuardar,
  esColumnaBooleana,
  tokenDeColorPorTipo,
  valorBooleano,
} from "./cell-model";
import { TOKENS_DEL_GRID, alturaDeFila, bordesVerticales, coloresDeTipo, temaDeGrid, type TokenDelGrid } from "./grid-theme";
import { PALETTES, contraste, tokensResueltosDePaleta } from "@/theme/palettes";
import type { TokenKey } from "@/theme/tokens";

/* ─── modelo de celda ─────────────────────────────────────────────────────── */

describe("pintarCelda: tope de lo que se DIBUJA (fase 12, T6)", () => {
  test("un valor enorme se recorta para la rejilla", () => {
    // Medido en la app: con UNA celda de 5 MB en el result set, cualquier interacción con la
    // rejilla pasaba a costar 5 030 ms — incluido pinchar una celda pequeña de otra columna.
    // Con 500 KB como máximo, 21 ms. El texto completo lo paga la rejilla en cada repintado
    // aunque de él se vean unos 60 caracteres.
    const enorme = "x".repeat(5_000_000);
    const pintada = pintarCelda(enorme, "text");
    assert.equal(pintada.texto.length, MAX_CARACTERES_EN_CELDA + MARCA_RECORTE.length);
    assert.ok(pintada.texto.endsWith(MARCA_RECORTE), "se avisa de que está recortado");
  });

  test("un valor normal NO se toca", () => {
    const normal = "y".repeat(MAX_CARACTERES_EN_CELDA);
    assert.equal(pintarCelda(normal, "text").texto, normal);
  });

  test("copiar y exportar siguen llevándose el valor COMPLETO", () => {
    // El recorte es sólo de pintura. Si se colara al portapapeles, copiar una celda grande daría
    // un dato truncado sin que nadie lo note hasta pegarlo en otra parte.
    const enorme = "z".repeat(5_000_000);
    assert.equal(celdaParaCopiar(enorme).length, 5_000_000);
  });
});

describe("pintarCelda", () => {
  test("NULL se distingue de la cadena vacía", () => {
    // Si los dos se pintaran igual, el usuario no podría saber si la columna está vacía o nula,
    // que en SQL es una diferencia que cambia el WHERE.
    const nulo = pintarCelda(null);
    const vacio = pintarCelda("");
    assert.equal(nulo.texto, TEXTO_NULO);
    assert.equal(nulo.esNulo, true);
    assert.equal(vacio.texto, "");
    assert.equal(vacio.esNulo, false);
    assert.equal(pintarCelda(undefined).esNulo, true);
  });

  test("jsonb y arrays se leen, no salen como [object Object]", () => {
    // Es el bug que se corrigió el 2026-10-09 y que no debe volver con el grid nuevo.
    assert.equal(pintarCelda({ vip: true, n: 2 }).texto, '{"vip":true,"n":2}');
    assert.equal(pintarCelda([1, 2, 3]).texto, "[1,2,3]");
  });

  test("los binarios salen en el formato de Postgres", () => {
    assert.equal(pintarCelda(new Uint8Array([0xde, 0xad])).texto, "\\xdead");
  });

  test("los números se alinean a la derecha y el resto a la izquierda", () => {
    for (const tipo of ["int4", "bigint", "numeric", "float8", "decimal", "money"]) {
      assert.equal(pintarCelda(1, tipo).alineacion, "derecha", `${tipo} va a la derecha`);
    }
    for (const tipo of ["text", "varchar", "jsonb", "date", "timestamptz", "bool"]) {
      assert.equal(pintarCelda("x", tipo).alineacion, "izquierda", `${tipo} va a la izquierda`);
    }
  });

  test("un array de enteros NO se alinea a la derecha", () => {
    // `int4[]` empieza por "int" pero se lee como texto; alinearlo a la derecha se vería mal.
    assert.equal(pintarCelda([1, 2], "int4[]").alineacion, "izquierda");
  });

  test("sin tipo de columna no revienta", () => {
    assert.equal(pintarCelda(42).alineacion, "izquierda");
  });
});

describe("celdaParaCopiar", () => {
  test("un NULL se copia como vacío, no como el literal [NULL]", () => {
    // Copiar "[NULL]" mete esa cadena como DATO al pegar en otra herramienta.
    assert.equal(celdaParaCopiar(null), "");
    assert.equal(pintarCelda(null).texto, TEXTO_NULO, "pero en pantalla sí se ve");
  });
});

/*
  Fase 14 (T5): aquí vivían `recortarRango`, `aTsv` y `aCsv` de `grid/clipboard.ts`. Ese módulo era
  código muerto (el ⌘C lo resolvía glide) y se borró: el camino vivo de «copiar como» es
  `grid/copy-as.ts`, y sus casos equivalentes (recorte por rango, escapado de TSV, escapado de CSV)
  viven en `copy-as.test.ts`, que además prueba el orden visible y el valor crudo.
*/

/* ─── tema ────────────────────────────────────────────────────────────────── */

describe("temaDeGrid", () => {
  const lector = (nombre: TokenDelGrid) => `valor-de-${nombre}`;

  test("ningún color del tema queda vacío", () => {
    // Es el fallo del spike de la fase 10: con un nombre de token inventado el valor sale vacío,
    // el grid se queda en sus colores por defecto y PARECE que no repinta al cambiar de tema.
    const tema = temaDeGrid(lector) as unknown as Record<string, unknown>;
    for (const [clave, valor] of Object.entries(tema)) {
      if (typeof valor !== "string") continue;
      assert.notEqual(valor.trim(), "", `${clave} salió vacío`);
    }
  });

  test("solo pide tokens de la lista declarada", () => {
    const pedidos: string[] = [];
    temaDeGrid((n) => {
      pedidos.push(n);
      return "#000000";
    });
    for (const p of pedidos) {
      assert.ok(
        (TOKENS_DEL_GRID as readonly string[]).includes(p),
        `${p} no está en TOKENS_DEL_GRID, así que nadie comprueba que exista`
      );
    }
  });

  test("el grid va en monoespaciada, como el de hoy", () => {
    assert.match(temaDeGrid(lector).fontFamily, /JetBrains Mono/);
  });

  test("R98: la cuadrícula se VE en todos los temas (antes, en Tokyo Night, línea ≈ fondo)", () => {
    for (const p of PALETTES) {
      const t = tokensResueltosDePaleta(p);
      const leer = (n: TokenDelGrid) => t[n.replace("--gdb-", "") as TokenKey];
      const marcada = temaDeGrid(leer, "marcada");
      const suave = temaDeGrid(leer, "suave");
      const c1 = contraste(marcada.horizontalBorderColor, marcada.bgCell);
      const c2 = contraste(suave.horizontalBorderColor, suave.bgCell);
      assert.ok(c1 >= 1.35, `${p.id}: la línea marcada contra la celda da ${c1.toFixed(2)}`);
      assert.ok(c2 >= 1.16 && c2 < c1, `${p.id}: la suave da ${c2.toFixed(2)}`);
      assert.equal(temaDeGrid(leer, "ninguna").horizontalBorderColor, t.field, "sin líneas = color de la celda");
    }
    assert.equal(bordesVerticales("ninguna"), false);
    assert.equal(bordesVerticales(), true);
  });
});

describe("alturaDeFila", () => {
  test("lee los px del token de densidad", () => {
    assert.equal(alturaDeFila("24px"), 24);
    assert.equal(alturaDeFila("28px"), 28);
  });

  test("un valor ausente o absurdo cae en el de por defecto", () => {
    for (const malo of ["", "auto", "0px", "-5px"]) {
      assert.equal(alturaDeFila(malo), 24, `"${malo}" debería caer en 24`);
    }
  });
});

describe("R98: booleanos como casilla y color por tipo", () => {
  test("qué columnas son booleanas en cada motor", () => {
    for (const t of ["boolean", "bool", "tinyint(1)", "bit", "BIT"]) assert.equal(esColumnaBooleana(t), true, t);
    for (const t of ["tinyint", "tinyint(4)", "bit(8)", "int", "varchar"]) assert.equal(esColumnaBooleana(t), false, t);
  });

  test("valorBooleano entiende cada forma del driver y deja como texto lo que no es 0/1", () => {
    assert.equal(valorBooleano(true), true);
    assert.equal(valorBooleano(0), false);
    assert.equal(valorBooleano(1), true);
    assert.equal(valorBooleano(new Uint8Array([1])), true);
    assert.equal(valorBooleano("f"), false);
    assert.equal(valorBooleano(7), null, "un TINYINT(1) con un 7 no se esconde tras una casilla");
    assert.equal(valorBooleano(null), null);
  });

  test("al marcar se guarda con la forma del original (1/0 en MySQL)", () => {
    assert.equal(booleanoParaGuardar(0, true), 1);
    assert.equal(booleanoParaGuardar(1, false), 0);
    assert.equal(booleanoParaGuardar(false, true), true);
  });

  test("color por tipo: números, fechas y JSON; el texto se queda normal", () => {
    assert.equal(tokenDeColorPorTipo("decimal"), "--gdb-num");
    assert.equal(tokenDeColorPorTipo("bigint"), "--gdb-num");
    assert.equal(tokenDeColorPorTipo("timestamp with time zone"), "--gdb-fn");
    assert.equal(tokenDeColorPorTipo("date"), "--gdb-fn");
    assert.equal(tokenDeColorPorTipo("jsonb"), "--gdb-str");
    assert.equal(tokenDeColorPorTipo("int4[]"), "--gdb-str");
    assert.equal(tokenDeColorPorTipo("varchar"), null);
    assert.equal(tokenDeColorPorTipo("tinyint(1)"), null);
  });

  test("los colores por tipo se leen sobre la celda en los 31 temas", () => {
    for (const p of PALETTES) {
      const t = tokensResueltosDePaleta(p);
      const colores = coloresDeTipo((n) => t[n.replace("--gdb-", "") as TokenKey]);
      for (const k of ["num", "fn", "str"] as const) {
        const c = contraste(colores[`--gdb-${k}`], t.field);
        assert.ok(c >= 3, `${p.id}: ${k} sobre la celda da ${c.toFixed(2)}`);
      }
    }
  });
});

describe("R98: la selección se ve igual de clara en todos los temas", () => {
  test("relleno de selección ≥1,3:1 sobre la celda, texto legible encima y anillo en el acento", () => {
    for (const p of PALETTES) {
      const t = tokensResueltosDePaleta(p);
      const tema = temaDeGrid((n) => t[n.replace("--gdb-", "") as TokenKey]);
      const c = contraste(tema.accentLight, tema.bgCell);
      assert.ok(c >= 1.3, `${p.id}: la selección contra la celda da ${c.toFixed(2)}`);
      const minimo = Math.min(3, contraste(t.fg, t.sel)) - 0.01;
      assert.ok(contraste(tema.textDark, tema.accentLight) >= minimo, `${p.id}: texto sobre la selección`);
      assert.equal(tema.accentColor, t.accent, `${p.id}: el anillo de la celda con foco es el acento`);
      assert.equal(tema.textHeaderSelected, t.onaccent);
    }
  });
});
