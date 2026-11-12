/**
 * Fase 15 (R13) · Tarea T7 — tests de la referencia de atajos generada del registro.
 *
 * Dos cosas se fijan aquí: (1) la referencia lista EXACTAMENTE las entradas del registro, sin una
 * fila de más ni de menos y con el texto de cada tecla salido de los conversores —es el invariante
 * que hace que D4 («una referencia que no puede mentir») sea comprobable—; y (2) el agrupado por
 * contexto y el buscador por nombre o tecla funcionan, incluidos acentos y alias.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { REGISTRO, aTextoMac, entradaPorId } from "./keymap";
import {
  NOTA_D2,
  ORDEN_CONTEXTOS,
  TITULOS_CONTEXTO,
  construirReferencia,
  etiquetaProcedencia,
  filtrarReferencia,
  totalDeFilas,
  type GrupoReferencia,
} from "./keymap-referencia";

describe("referencia de atajos — agrupado desde el registro", () => {
  test("un grupo por contexto, en el orden del PLAN, con su título", () => {
    const grupos = construirReferencia();
    assert.deepEqual(
      grupos.map((g) => g.contexto),
      ["global", "editor", "rejilla", "arbol"]
    );
    assert.deepEqual(
      grupos.map((g) => g.titulo),
      ["Global", "Editor SQL", "Rejilla de datos", "Árbol de esquema"]
    );
    assert.deepEqual(grupos.map((g) => g.contexto), [...ORDEN_CONTEXTOS]);
    assert.deepEqual(TITULOS_CONTEXTO.editor, "Editor SQL");
  });

  test("conteo por contexto = el del registro (15 / 16 / 9 / 1)", () => {
    const grupos = construirReferencia();
    assert.deepEqual(
      grupos.map((g) => g.filas.length),
      [15, 16, 9, 1]
    );
    assert.equal(totalDeFilas(grupos), REGISTRO.length);
  });

  test("la referencia lista EXACTAMENTE las entradas del registro (ni una más ni una menos)", () => {
    // Es la comprobación que el criterio de T8 hará entre lo pintado y el registro; aquí se hace
    // sobre los datos, que es donde puede fallar de verdad.
    const ids = new Set(construirReferencia().flatMap((g) => g.filas.map((f) => f.id)));
    assert.equal(ids.size, REGISTRO.length, "hay filas repetidas o de menos");
    for (const e of REGISTRO) assert.ok(ids.has(e.id), `falta la fila de "${e.id}"`);
  });

  test("cada fila lleva el nombre, el atajo y los alias de su entrada (del conversor, no a mano)", () => {
    for (const g of construirReferencia()) {
      for (const f of g.filas) {
        const e = entradaPorId(f.id);
        assert.ok(e, `"${f.id}" no está en el registro`);
        assert.equal(f.nombre, e.nombre);
        assert.equal(f.atajo, aTextoMac(e.tecla), `atajo de "${f.id}"`);
        assert.deepEqual(f.alias, (e.alias ?? []).map(aTextoMac), `alias de "${f.id}"`);
        assert.equal(f.procedencia, e.procedencia);
        assert.equal(f.fila, e.fila);
      }
    }
  });

  test("las filas [D] son las que exigen la nota de D2 y la tienen disponible", () => {
    const conD = construirReferencia().flatMap((g) => g.filas).filter((f) => f.procedencia === "D");
    assert.ok(conD.length > 0, "la tabla tiene filas [D] y la referencia debe marcarlas");
    assert.equal(NOTA_D2, "convertida desde el keymap de Windows, sin verificar en un DataGrip real");
    assert.ok(conD.some((f) => f.id === "execute"), "⌘⏎ es [D]");
    assert.ok(conD.some((f) => f.id === "newQueryConsole"), "⌘⇧Q es [D]");
  });

  test("etiquetaProcedencia: [M], [D] y «—» para los atajos propios de DataDB", () => {
    assert.equal(etiquetaProcedencia("M"), "[M]");
    assert.equal(etiquetaProcedencia("D"), "[D]");
    assert.equal(etiquetaProcedencia("app"), "—");
  });

  test("los atajos por foco y los alias viajan a la referencia tal cual", () => {
    const filas = construirReferencia().flatMap((g) => g.filas);
    const diagrama = filas.find((f) => f.id === "showDiagram");
    assert.ok(diagrama);
    assert.equal(diagrama.atajo, "⌘⌥⇧U");
    assert.deepEqual(diagrama.alias, ["⌘⇧U"]);
    const paleta = filas.find((f) => f.id === "findAction");
    assert.deepEqual(paleta?.alias, ["⌘K"]);
    // El marco por foco del registro (`porFoco`) no es un dato de la fila: la referencia no lo pinta.
    assert.equal("porFoco" in (diagrama as object), false);
  });
});

describe("referencia de atajos — buscador", () => {
  const grupos = construirReferencia();

  test("sin consulta devuelve todo; con espacios, también", () => {
    assert.equal(totalDeFilas(filtrarReferencia(grupos, "")), REGISTRO.length);
    assert.equal(totalDeFilas(filtrarReferencia(grupos, "   ")), REGISTRO.length);
  });

  test("por nombre de la acción, sin distinguir mayúsculas", () => {
    const r = filtrarReferencia(grupos, "reformat");
    assert.deepEqual(r.flatMap((g) => g.filas.map((f) => f.id)), ["reformatCode"]);
    assert.equal(filtrarReferencia(grupos, "REFORMAT").length, 1);
  });

  test("por tecla principal («⌘⌥L») y por alias («⌘K»)", () => {
    assert.deepEqual(
      filtrarReferencia(grupos, "⌘⌥L").flatMap((g) => g.filas.map((f) => f.id)),
      ["reformatCode"]
    );
    assert.deepEqual(
      filtrarReferencia(grupos, "⌘K").flatMap((g) => g.filas.map((f) => f.id)),
      ["findAction"],
      "⌘K es el alias de Find Action (D1)"
    );
    // Un fragmento también vale: `⇧⌘]` es ⌘⇧] con el orden de DataGrip.
    assert.deepEqual(
      filtrarReferencia(grupos, "⌘⇧]").flatMap((g) => g.filas.map((f) => f.id)),
      ["selectNextTab"]
    );
  });

  test("por id del registro, y el normalizador quita acentos", () => {
    assert.deepEqual(
      filtrarReferencia(grupos, "nextTab").flatMap((g) => g.filas.map((f) => f.id)),
      ["selectNextTab"]
    );
    // Los nombres de DataGrip van en inglés y no llevan acentos, pero el buscador no debe depender
    // de eso: se comprueba con una fila acentuada de verdad (y en mayúsculas).
    const conAcento: GrupoReferencia[] = [
      {
        contexto: "arbol",
        titulo: "Árbol de esquema",
        filas: [{ id: "x", nombre: "Refrescar árbol", atajo: "⌘R", alias: [], procedencia: "D", fila: 18 }],
      },
    ];
    assert.deepEqual(
      filtrarReferencia(conAcento, "arbol").flatMap((g) => g.filas.map((f) => f.id)),
      ["x"]
    );
    assert.deepEqual(
      filtrarReferencia(conAcento, "ÁRBOL").flatMap((g) => g.filas.map((f) => f.id)),
      ["x"]
    );
    // El buscador mira nombre/atajo/id de cada fila, NO el título del grupo: «arbol» sobre el
    // registro real (acciones en inglés) no encuentra nada.
    assert.deepEqual(filtrarReferencia(grupos, "arbol"), []);
  });

  test("filtra dentro de los grupos y elimina los que se quedan vacíos", () => {
    const r = filtrarReferencia(grupos, "duplicate");
    assert.equal(r.length, 1);
    assert.equal(r[0].contexto, "editor");
    assert.deepEqual(r[0].filas.map((f) => f.id), ["duplicateLine"]);
  });

  test("una consulta que no casa con nada devuelve cero grupos, no todos", () => {
    assert.deepEqual(filtrarReferencia(grupos, "zzzz-no-existe"), []);
  });
});
