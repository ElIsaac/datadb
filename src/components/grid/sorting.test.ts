import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compararValores,
  nivelDe,
  ordenarIndices,
  siguienteOrden,
  type OrdenDeGrid,
} from "./sorting";

describe("compararValores", () => {
  test("los NULL van al final tanto en asc como en desc", () => {
    // Ordenar una columna y encontrarte los NULL arriba hace el orden inservible.
    assert.ok(compararValores(null, 5, "asc") > 0);
    assert.ok(compararValores(null, 5, "desc") > 0, "también en descendente");
    assert.ok(compararValores(5, null, "desc") < 0);
    assert.equal(compararValores(null, undefined, "asc"), 0);
  });

  test("los números que llegan como cadena se comparan como números", () => {
    // `numeric` y `bigint` llegan del driver como texto para no perder precisión. Como cadenas,
    // "10" iría antes que "9".
    assert.ok(compararValores("10", "9", "asc") > 0);
    assert.ok(compararValores("12.50", "9.99", "asc") > 0);
    assert.ok(compararValores(10, "9", "asc") > 0);
  });

  test("el texto usa orden natural: 'fila 2' antes que 'fila 10'", () => {
    assert.ok(compararValores("fila 2", "fila 10", "asc") < 0);
  });

  test("los booleanos ordenan false antes que true", () => {
    assert.ok(compararValores(false, true, "asc") < 0);
    assert.ok(compararValores(false, true, "desc") > 0);
  });

  test("las fechas ISO se ordenan bien como texto", () => {
    // Es la ventaja de que el driver mande ISO / texto de reloj de pared: el orden lexicográfico
    // coincide con el cronológico.
    assert.ok(compararValores("2026-01-02 08:00:00", "2026-01-02 09:00:00", "asc") < 0);
    assert.ok(compararValores("2024-12-31", "2025-01-01", "asc") < 0);
  });
});

describe("ordenarIndices", () => {
  const filas = [
    { id: 3, nombre: "cee", importe: "100.00" },
    { id: 1, nombre: "aaa", importe: "9.99" },
    { id: 2, nombre: null, importe: "50.00" },
  ];

  test("devuelve índices, no filas", () => {
    // El grid guarda los cambios pendientes contra la posición original: si se reordenara el
    // array, una edición hecha antes de ordenar apuntaría a otra fila.
    const r = ordenarIndices(filas, [{ columna: "id", direccion: "asc" }]);
    assert.deepEqual(r, [1, 2, 0]);
    assert.equal(filas[0].id, 3, "el array original no se toca");
  });

  test("sin orden (lista vacía), el orden es el original", () => {
    assert.deepEqual(ordenarIndices(filas, []), [0, 1, 2]);
  });

  test("ordena numéricamente una columna que llega como cadena", () => {
    const r = ordenarIndices(filas, [{ columna: "importe", direccion: "asc" }]);
    assert.deepEqual(r.map((i) => filas[i].importe), ["9.99", "50.00", "100.00"]);
  });

  test("la fila con NULL queda al final", () => {
    const r = ordenarIndices(filas, [{ columna: "nombre", direccion: "asc" }]);
    assert.equal(filas[r[r.length - 1]].nombre, null);
  });

  test("una columna que no existe no revienta", () => {
    assert.equal(ordenarIndices(filas, [{ columna: "no_existe", direccion: "asc" }]).length, 3);
  });
});

describe("ordenarIndices con varios niveles", () => {
  // `ciudad` tiene empates a propósito: Madrid en 0, 2 y 4; Bogotá en 1 y 3.
  const filas = [
    { ciudad: "Madrid", importe: 300, id: 0 },
    { ciudad: "Bogotá", importe: 100, id: 1 },
    { ciudad: "Madrid", importe: 100, id: 2 },
    { ciudad: "Bogotá", importe: 200, id: 3 },
    { ciudad: "Madrid", importe: 100, id: 4 },
  ];

  test("el segundo nivel desempata al primero", () => {
    // Bogotá ordena antes que Madrid (localeCompare «es»): 100 (1) antes que 200 (3).
    // Madrid: importe 100 (2 y 4, empatados entre sí → índice original) antes que 300 (0).
    const r = ordenarIndices(filas, [
      { columna: "ciudad", direccion: "asc" },
      { columna: "importe", direccion: "asc" },
    ]);
    assert.deepEqual(r, [1, 3, 2, 4, 0]);
  });

  test("el segundo nivel puede ir en dirección distinta al primero", () => {
    const r = ordenarIndices(filas, [
      { columna: "ciudad", direccion: "asc" },
      { columna: "importe", direccion: "desc" },
    ]);
    // Bogotá: 200 (3) antes que 100 (1). Madrid: 300 (0), luego 100 (2 y 4, empate → índice).
    assert.deepEqual(r, [3, 1, 0, 2, 4]);
  });

  test("tres niveles: el tercero desempata a los dos anteriores", () => {
    const filas3 = [
      { pais: "ES", ciudad: "Madrid", n: 2 }, // 0
      { pais: "ES", ciudad: "Madrid", n: 1 }, // 1
      { pais: "MX", ciudad: "Madrid", n: 5 }, // 2
      { pais: "ES", ciudad: "Bogotá", n: 9 }, // 3
      { pais: "MX", ciudad: "Madrid", n: 1 }, // 4
    ];
    const r = ordenarIndices(filas3, [
      { columna: "pais", direccion: "asc" },
      { columna: "ciudad", direccion: "asc" },
      { columna: "n", direccion: "asc" },
    ]);
    // ES/Bogotá (3) antes que ES/Madrid (1 con n=1, 0 con n=2); luego MX/Madrid (4 con n=1, 2 con n=5).
    assert.deepEqual(r, [3, 1, 0, 4, 2]);
  });

  test("NULL al final en CADA nivel y en las dos direcciones", () => {
    const filasNulos = [
      { grupo: "a", valor: 1 }, // 0
      { grupo: null, valor: 2 }, // 1
      { grupo: "a", valor: null }, // 2
      { grupo: null, valor: null }, // 3
      { grupo: "a", valor: 2 }, // 4
    ];
    const asc = ordenarIndices(filasNulos, [
      { columna: "grupo", direccion: "asc" },
      { columna: "valor", direccion: "asc" },
    ]);
    // Grupo «a» primero (el NULL del nivel 1 va al final); dentro, 1 < 2 < NULL.
    assert.deepEqual(asc, [0, 4, 2, 1, 3]);

    const desc = ordenarIndices(filasNulos, [
      { columna: "grupo", direccion: "asc" },
      { columna: "valor", direccion: "desc" },
    ]);
    // El 2º nivel invierte 1 y 2, pero SU NULL sigue al final; y el grupo NULL sigue al final.
    assert.deepEqual(desc, [4, 0, 2, 1, 3]);
  });

  test("el NULL del primer nivel también va al final en descendente", () => {
    const filasNulos = [
      { grupo: null, valor: 1 }, // 0
      { grupo: "a", valor: 1 }, // 1
    ];
    assert.deepEqual(ordenarIndices(filasNulos, [{ columna: "grupo", direccion: "desc" }]), [1, 0]);
  });
});

describe("ordenarIndices con candidatos del filtro (fase 13)", () => {
  const filas = [
    { id: 5 }, // 0
    { id: 2 }, // 1
    { id: 9 }, // 2
    { id: 1 }, // 3
  ];

  test("ordena sólo los candidatos y devuelve sus índices ORIGINALES", () => {
    assert.deepEqual(ordenarIndices(filas, [{ columna: "id", direccion: "asc" }], [3, 1]), [3, 1]);
    assert.deepEqual(ordenarIndices(filas, [{ columna: "id", direccion: "desc" }], [0, 2]), [2, 0]);
  });

  test("sin orden devuelve los candidatos tal cual (no los reordena)", () => {
    assert.deepEqual(ordenarIndices(filas, [], [2, 0]), [2, 0]);
  });

  test("no muta la lista de candidatos", () => {
    const candidatos = [3, 1];
    ordenarIndices(filas, [{ columna: "id", direccion: "asc" }], candidatos);
    assert.deepEqual(candidatos, [3, 1]);
  });

  test("con dos niveles, el segundo desempata también entre candidatos", () => {
    const conEmpate = [
      { g: "x", n: 2 }, // 0
      { g: "x", n: 1 }, // 1
      { g: "y", n: 0 }, // 2
    ];
    assert.deepEqual(
      ordenarIndices(
        conEmpate,
        [
          { columna: "g", direccion: "asc" },
          { columna: "n", direccion: "asc" },
        ],
        [0, 1]
      ),
      [1, 0]
    );
  });
});

describe("estabilidad del orden", () => {
  test("filas iguales en TODOS los niveles salen por índice original ascendente", () => {
    const filas = [{ x: 1 }, { x: 1 }, { x: 1 }, { x: 1 }];
    assert.deepEqual(ordenarIndices(filas, [{ columna: "x", direccion: "desc" }]), [0, 1, 2, 3]);
  });

  test("el desempate es por índice original, no por el orden en que llegaron los candidatos", () => {
    const filas = [{ x: 1 }, { x: 1 }, { x: 1 }];
    assert.deepEqual(ordenarIndices(filas, [{ columna: "x", direccion: "asc" }], [2, 0, 1]), [0, 1, 2]);
  });

  test("dos llamadas con los mismos datos dan el mismo resultado", () => {
    const filas = [
      { g: "b", n: 1 }, // 0
      { g: "a", n: 2 }, // 1
      { g: "b", n: 1 }, // 2
      { g: "a", n: 2 }, // 3
      { g: "a", n: 1 }, // 4
    ];
    const orden: OrdenDeGrid = [
      { columna: "g", direccion: "asc" },
      { columna: "n", direccion: "asc" },
    ];
    assert.deepEqual(ordenarIndices(filas, orden), ordenarIndices(filas, orden));
    // a/n1 (4), luego a/n2 (1 y 3, empate total → índice), luego b (0 y 2, empate total → índice).
    assert.deepEqual(ordenarIndices(filas, orden), [4, 1, 3, 0, 2]);
  });
});

describe("siguienteOrden", () => {
  test("el ciclo de un único nivel es asc → desc → sin orden", () => {
    const a = siguienteOrden([], "id");
    assert.deepEqual(a, [{ columna: "id", direccion: "asc" }]);
    const b = siguienteOrden(a, "id");
    assert.deepEqual(b, [{ columna: "id", direccion: "desc" }]);
    assert.deepEqual(siguienteOrden(b, "id"), []);
  });

  test("pulsar otra columna reemplaza el orden por esa columna en ascendente", () => {
    const actual: OrdenDeGrid = [{ columna: "id", direccion: "desc" }];
    assert.deepEqual(siguienteOrden(actual, "nombre"), [{ columna: "nombre", direccion: "asc" }]);
  });

  test("sin ⌥ tras un multinivel, el orden queda con UN nivel", () => {
    const actual: OrdenDeGrid = [
      { columna: "ciudad", direccion: "asc" },
      { columna: "id", direccion: "desc" },
    ];
    assert.deepEqual(siguienteOrden(actual, "nombre"), [{ columna: "nombre", direccion: "asc" }]);
    // Incluso con una columna que YA estaba en el orden: no cicla su dirección (no es el único
    // nivel), el orden pasa a ser sólo ella en ascendente.
    assert.deepEqual(siguienteOrden(actual, "id"), [{ columna: "id", direccion: "asc" }]);
  });
});

describe("siguienteOrden con apilar (⌥+clic, D1)", () => {
  test("apila una columna que no estaba, AL FINAL y en ascendente", () => {
    const actual: OrdenDeGrid = [{ columna: "ciudad", direccion: "desc" }];
    assert.deepEqual(siguienteOrden(actual, "id", true), [
      { columna: "ciudad", direccion: "desc" },
      { columna: "id", direccion: "asc" },
    ]);
  });

  test("cicla SU dirección sin moverla de posición", () => {
    const actual: OrdenDeGrid = [
      { columna: "ciudad", direccion: "asc" },
      { columna: "id", direccion: "asc" },
    ];
    // El nivel 1 pasa a desc y el 2 se queda donde estaba: «apilar» no reordena los niveles.
    assert.deepEqual(siguienteOrden(actual, "ciudad", true), [
      { columna: "ciudad", direccion: "desc" },
      { columna: "id", direccion: "asc" },
    ]);
    assert.deepEqual(siguienteOrden(actual, "id", true), [
      { columna: "ciudad", direccion: "asc" },
      { columna: "id", direccion: "desc" },
    ]);
  });

  test("quitar un nivel del MEDIO: los de detrás suben uno", () => {
    const actual: OrdenDeGrid = [
      { columna: "a", direccion: "asc" },
      { columna: "b", direccion: "desc" },
      { columna: "c", direccion: "asc" },
    ];
    // `b` ya estaba en desc: el ⌥+clic la quita.
    assert.deepEqual(siguienteOrden(actual, "b", true), [
      { columna: "a", direccion: "asc" },
      { columna: "c", direccion: "asc" },
    ]);
  });

  test("no muta el orden actual", () => {
    const actual: OrdenDeGrid = [
      { columna: "a", direccion: "asc" },
      { columna: "b", direccion: "desc" },
    ];
    siguienteOrden(actual, "b", true); // quita `b`
    siguienteOrden(actual, "c", true); // añade `c`
    siguienteOrden(actual, "a", true); // cicla `a`
    assert.deepEqual(actual, [
      { columna: "a", direccion: "asc" },
      { columna: "b", direccion: "desc" },
    ]);
  });
});

describe("nivelDe", () => {
  const orden: OrdenDeGrid = [
    { columna: "ciudad", direccion: "asc" },
    { columna: "importe", direccion: "desc" },
    { columna: "id", direccion: "asc" },
  ];

  test("devuelve el número de nivel (1 = el que manda), su dirección y el total", () => {
    assert.deepEqual(nivelDe(orden, "ciudad"), { nivel: 1, direccion: "asc", total: 3 });
    assert.deepEqual(nivelDe(orden, "importe"), { nivel: 2, direccion: "desc", total: 3 });
    assert.deepEqual(nivelDe(orden, "id"), { nivel: 3, direccion: "asc", total: 3 });
  });

  test("una columna que no está en el orden no tiene nivel", () => {
    assert.equal(nivelDe(orden, "no_existe"), null);
    assert.equal(nivelDe([], "ciudad"), null);
  });

  test("con un solo nivel el total es 1 (T3 no pintará el número)", () => {
    assert.deepEqual(nivelDe([{ columna: "id", direccion: "desc" }], "id"), {
      nivel: 1,
      direccion: "desc",
      total: 1,
    });
  });
});

describe("COLADOR: el cambio de localeCompare a Intl.Collator no cambia NADA (fase 14, T3)", () => {
  /*
   * T3 sustituyó `String(a).localeCompare(b, "es", { numeric: true, sensitivity: "base" })` —que
   * construye un colador nuevo en cada llamada y costaba ~1,8 µs— por un `Intl.Collator` creado una
   * vez a nivel de módulo: 100 000 filas de texto pasan de 1 712 ms a 137 ms (mediana de 5).
   *
   * Lo que hace segura esa optimización no es «parece que da lo mismo»: ECMA-402 define
   * `String.prototype.localeCompare` como la comparación de un `Intl.Collator` construido con esos
   * locales y esas opciones, así que son LA MISMA operación. Estos tests lo fijan por si alguien
   * cambia el locale o las opciones del colador más adelante.
   */
  const valores = [
    "", // vacío (la cadena más pequeña en cualquier collation)
    " ",
    "fila 2",
    "fila 10", // números embebidos: orden natural, no lexicográfico
    "Fila 2",
    "FILA 10", // mayúsculas: las pliega `sensitivity: "base"`
    "árbol",
    "Arbol",
    "ÁRBOL",
    "árboles", // acentos: los pliega, y "árbol" < "árboles"
    "Zorro",
    "zorro",
    "Ñu",
    "nube",
    "O'Brien",
    "o'brien",
    "10",
    "9", // como texto, orden natural: "9" antes que "10"
    "2.5",
    "2,5",
    "007", // el camino numérico lo trata como 7; el colador, también
    "Mérida",
    "Merida",
    "monterrey",
    "Monterrey", // Mérida vs Monterrey: la 'é' no decide (ambos caminos coinciden)
    "León",
    "leon",
    "Ciudad de México",
    "ciudad de mexico",
  ];

  test("cada par de valores da el mismo signo por los dos caminos", () => {
    let pares = 0;
    for (const a of valores) {
      for (const b of valores) {
        const esperado = Math.sign(
          String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" })
        );
        const obtenido = Math.sign(compararValores(a, b, "asc"));
        assert.equal(
          obtenido,
          esperado,
          `compararValores(${JSON.stringify(a)}, ${JSON.stringify(b)}) dio ${obtenido}, localeCompare dio ${esperado}`
        );
        pares++;
      }
    }
    // El conteo se afirma a sí mismo: un bucle mal escrito (p. ej. un `break` colado) pasaría sin
    // recorrer los 841 pares y el test no probaría nada.
    assert.equal(pares, valores.length ** 2);
  });

  test("ordenar una lista con los dos caminos da el MISMO array (no solo los mismos signos)", () => {
    // Con empates (mayúsculas/acentos que el colador pliega) el orden final depende del desempate
    // estable, así que esto compara también que los empates coinciden.
    const mezcla = ["fila 10", "Árbol", "árbol", "fila 2", "", " ", "Ñu", "nube", "007", "9", "10", "Mérida", "merida"];
    const indices = (comparar: (a: string, b: string) => number) =>
      mezcla.map((_, i) => i).sort((ia, ib) => comparar(mezcla[ia], mezcla[ib]) || ia - ib);
    assert.deepEqual(
      indices((a, b) => compararValores(a, b, "asc")),
      indices((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }))
    );
  });

  test("pliega mayúsculas y acentos: «Mérida» y «merida» empatan (sensitivity base)", () => {
    assert.equal(compararValores("Mérida", "merida", "asc"), 0);
    assert.equal(compararValores("ÁRBOL", "arbol", "asc"), 0);
    // Y «árbol» va antes que «árboles» (el plural no es empate).
    assert.ok(compararValores("árbol", "árboles", "asc") < 0);
  });
});
