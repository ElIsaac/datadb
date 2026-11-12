/**
 * Fase 12 (T1). El store de la celda enfocada es la pieza de la que vive el value editor, y tiene
 * una regla que no es obvia: **ignora las actualizaciones que no cambian nada**. La rejilla dispara
 * su `onGridSelectionChange` también al arrastrar dentro de la celda ya activa, así que sin este
 * filtro el panel se repintaría en cada movimiento del ratón.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCeldaEnfocada, setCeldaEnfocada } from "./focused-cell";

function celda(extra: Partial<Parameters<typeof setCeldaEnfocada>[0] & object> = {}) {
  return {
    columna: "meta",
    tipo: "jsonb",
    indiceOriginal: 7,
    valor: { a: 1 },
    editable: true,
    ...extra,
  };
}

describe("store de la celda enfocada", () => {
  it("publica la celda y la devuelve tal cual", () => {
    const c = celda();
    setCeldaEnfocada(c);
    assert.equal(getCeldaEnfocada()?.columna, "meta");
    assert.equal(getCeldaEnfocada()?.indiceOriginal, 7);
  });

  it("no avisa dos veces de la MISMA celda", () => {
    // El valor se comparte a propósito: es lo que hace la rejilla, que pasa `filas[i][columna]` y
    // por tanto SIEMPRE la misma referencia mientras el array de datos no cambie.
    const valor = { a: 1 };
    setCeldaEnfocada(celda({ valor }));
    const anterior = getCeldaEnfocada();
    setCeldaEnfocada(celda({ valor }));
    // Si no hubo reemplazo, la referencia es la misma y los suscriptores no se llamaron.
    assert.equal(getCeldaEnfocada(), anterior, "una celda idéntica no debe reemplazar el estado");
  });

  it("un objeto NUEVO con el mismo contenido sí cuenta como cambio (comparación por referencia)", () => {
    // Documentado a propósito: comparar `jsonb` por contenido obligaría a serializar en cada
    // movimiento del cursor, que es justo lo que este filtro quiere evitar. El caso real en el que
    // ocurre —recargar el result set— es además uno en el que repintar es lo correcto.
    setCeldaEnfocada(celda({ valor: { a: 1 } }));
    const anterior = getCeldaEnfocada();
    setCeldaEnfocada(celda({ valor: { a: 1 } }));
    assert.notEqual(getCeldaEnfocada(), anterior);
  });

  it("sí cambia cuando cambia el VALOR aunque sea la misma posición", () => {
    setCeldaEnfocada(celda({ valor: "antes" }));
    const anterior = getCeldaEnfocada();
    setCeldaEnfocada(celda({ valor: "después" }));
    assert.notEqual(getCeldaEnfocada(), anterior);
    assert.equal(getCeldaEnfocada()?.valor, "después");
  });

  it("sí cambia cuando la celda deja de ser editable", () => {
    const valor = { a: 1 };
    setCeldaEnfocada(celda({ valor, editable: true }));
    setCeldaEnfocada(celda({ valor, editable: false }));
    assert.equal(getCeldaEnfocada()?.editable, false);
  });

  it("acepta null cuando no hay celda activa", () => {
    setCeldaEnfocada(celda());
    setCeldaEnfocada(null);
    assert.equal(getCeldaEnfocada(), null);
  });

  it("distingue dos celdas de la misma columna en filas distintas", () => {
    const valor = { a: 1 };
    setCeldaEnfocada(celda({ valor, indiceOriginal: 1 }));
    const anterior = getCeldaEnfocada();
    setCeldaEnfocada(celda({ valor, indiceOriginal: 2 }));
    assert.notEqual(getCeldaEnfocada(), anterior);
    assert.equal(getCeldaEnfocada()?.indiceOriginal, 2);
  });
});
