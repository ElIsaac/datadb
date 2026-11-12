import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseCondicion,
  casaCondicion,
  parsearFiltros,
  filtrarIndices,
  hayFiltro,
  firmaDeColumnas,
} from "./filtering";

/* ─── parseo ──────────────────────────────────────────────────────────────── */

describe("parseCondicion: lo que se escribe en la fila de filtros (fase 13)", () => {
  test("vacío no es un filtro", () => {
    // Es la diferencia entre «no filtrar» y «filtrar por la cadena vacía», que casaría con medio
    // result set y vaciaría la rejilla de la forma más confusa posible.
    assert.equal(parseCondicion(""), null);
    assert.equal(parseCondicion("   "), null);
  });

  test("sin operador es «contiene»", () => {
    assert.deepEqual(parseCondicion("ana"), { tipo: "contiene", texto: "ana" });
    assert.deepEqual(parseCondicion("  ana  "), { tipo: "contiene", texto: "ana" });
  });

  test("null y !null se reconocen sin distinguir mayúsculas", () => {
    for (const t of ["null", "NULL", " Null "]) {
      assert.deepEqual(parseCondicion(t), { tipo: "nulo", negado: false }, t);
    }
    for (const t of ["!null", "NOT NULL", "notnull"]) {
      assert.deepEqual(parseCondicion(t), { tipo: "nulo", negado: true }, t);
    }
  });

  test("el operador más largo gana: «<=» no es «<»", () => {
    // Sin esto, escribir `<=5` se leería como `<` con valor `=5`, que no casa con nada.
    assert.deepEqual(parseCondicion("<=5"), { tipo: "op", op: "<=", valor: "5" });
    assert.deepEqual(parseCondicion(">=5"), { tipo: "op", op: ">=", valor: "5" });
    assert.deepEqual(parseCondicion("!=5"), { tipo: "op", op: "!=", valor: "5" });
    assert.deepEqual(parseCondicion("=activo"), { tipo: "op", op: "=", valor: "activo" });
    assert.deepEqual(parseCondicion("> 5"), { tipo: "op", op: ">", valor: "5" });
  });

  test("un operador a MEDIAS cae a «contiene» en vez de vaciar la rejilla", () => {
    // Mientras se teclea `>=` se pasa por `>` sin valor. Si eso fuera un filtro válido, la rejilla
    // parpadearía a vacío a medio escribir.
    assert.deepEqual(parseCondicion(">"), { tipo: "contiene", texto: ">" });
    assert.deepEqual(parseCondicion("> "), { tipo: "contiene", texto: ">" });
    assert.deepEqual(parseCondicion("="), { tipo: "contiene", texto: "=" });
  });
});

/* ─── «contiene» ──────────────────────────────────────────────────────────── */

describe("casaCondicion: contiene", () => {
  const contiene = (t: string) => parseCondicion(t)!;

  test("no distingue mayúsculas", () => {
    assert.equal(casaCondicion("Ana Gómez", contiene("ana")), true);
    assert.equal(casaCondicion("ANA", contiene("ana")), true);
  });

  test("los acentos SÍ cuentan", () => {
    // Como en DataGrip: plegar acentos haría que «o» encontrara «ó».
    assert.equal(casaCondicion("México", contiene("méx")), true);
    assert.equal(casaCondicion("México", contiene("mex")), false);
  });

  test("un NULL no contiene nada", () => {
    assert.equal(casaCondicion(null, contiene("a")), false);
    assert.equal(casaCondicion(undefined, contiene("a")), false);
  });

  test("la cadena vacía no se confunde con NULL", () => {
    // Es la distinción que `grid.test.ts` ya vigila para la pintura. Ojo con el detalle de aquí
    // abajo: «contiene vacío» NO es un filtro (caería sobre medio result set), así que no hay
    // ninguna forma de escribir «sólo las celdas vacías» — eso es `= ` ... tampoco, porque el
    // texto se recorta. Se enseña explícitamente para que nadie lo "arregle" sin querer.
    assert.equal(parseCondicion(""), null);
    assert.equal(casaCondicion("", contiene("a")), false);
    assert.equal(casaCondicion("", parseCondicion("null")!), false, "vacío no es NULL");
  });

  test("un jsonb se filtra por el JSON que se VE, no por [object Object]", () => {
    // El bug corregido el 2026-10-09: en crudo un jsonb es un objeto, y String(valor) da
    // "[object Object]", con el que no casa ninguna búsqueda sensata.
    assert.equal(casaCondicion({ vip: true, n: 2 }, contiene("vip")), true);
    assert.equal(casaCondicion({ vip: true, n: 2 }, contiene("[object")), false);
    assert.equal(casaCondicion([1, 2, 3], contiene("[1,2")), true);
  });

  test("los números se buscan por su texto", () => {
    assert.equal(casaCondicion(1234, contiene("23")), true);
    assert.equal(casaCondicion("1234", contiene("23")), true);
  });
});

/* ─── operadores ──────────────────────────────────────────────────────────── */

describe("casaCondicion: operadores", () => {
  const op = (t: string) => parseCondicion(t)!;

  test("numérico aunque llegue como cadena del driver", () => {
    // `numeric`/`bigint` llegan en texto para no perder precisión: comparar "9" con "10" como
    // cadenas pondría el 10 primero. Mismo criterio que el orden (aNumero).
    assert.equal(casaCondicion("9", op(">10")), false);
    assert.equal(casaCondicion("10", op(">9")), true);
    assert.equal(casaCondicion("9", op("<10")), true);
    assert.equal(casaCondicion(10, op(">=10")), true);
    assert.equal(casaCondicion("10", op("<=9")), false);
  });

  test("= y != son exactos, no «contiene»", () => {
    assert.equal(casaCondicion("inactivo", op("=activo")), false);
    assert.equal(casaCondicion("activo", op("=activo")), true);
    assert.equal(casaCondicion("inactivo", op("!=activo")), true);
    assert.equal(casaCondicion("Activo", op("=activo")), false, "exacto es exacto, también en mayúsculas");
  });

  test("= numérico tolera la forma: «10.0» es 10", () => {
    assert.equal(casaCondicion("10.0", op("=10")), true);
    assert.equal(casaCondicion("10.5", op("=10")), false);
    assert.equal(casaCondicion("10.0", op("!=10")), false);
  });

  test("un NULL no casa con ningún operador, como en SQL", () => {
    // `NULL != 10` es DESCONOCIDO en SQL, no verdadero. Para ver los NULL está `null`; para
    // esconderlos, `!null`.
    for (const t of [">0", ">=0", "<0", "<=0", "=0", "!=0", "=a"]) {
      assert.equal(casaCondicion(null, op(t)), false, t);
    }
  });

  test("los operadores también sirven para texto, con orden natural", () => {
    // Una fecha ISO se compara como fecha por el orden de sus componentes, que es la ventaja de
    // comparar el texto tal cual y no parsearlo.
    assert.equal(casaCondicion("2026-01-02", op(">2025-12-31")), true);
    assert.equal(casaCondicion("2026-01-02", op("<2026-01-02")), false);
    assert.equal(casaCondicion("fila 10", op(">fila 2")), true, "orden natural, no alfabético");
  });

  test("los booleanos se comparan por su texto, que es lo que se ve", () => {
    // Diferencia consciente con el orden: `sorting.ts` compara booleanos con `Number(a)`, porque
    // ahí sólo importa el orden relativo. Aquí lo que se teclea es lo que se ve en la celda
    // («true»/«false»), así que `=1` no casa con `true` — sorprendería a quien no lo pidió.
    assert.equal(casaCondicion(true, op("=true")), true);
    assert.equal(casaCondicion(false, op("=false")), true);
    assert.equal(casaCondicion("true", op("=true")), true, "y en texto, igual");
    assert.equal(casaCondicion(true, op("=1")), false);
  });
});

/* ─── null / !null ────────────────────────────────────────────────────────── */

describe("casaCondicion: null y !null", () => {
  test("null enseña los NULL; !null los esconde", () => {
    assert.equal(casaCondicion(null, parseCondicion("null")!), true);
    assert.equal(casaCondicion(undefined, parseCondicion("null")!), true);
    assert.equal(casaCondicion("", parseCondicion("null")!), false, "vacío no es NULL");
    assert.equal(casaCondicion(0, parseCondicion("null")!), false);
    assert.equal(casaCondicion(null, parseCondicion("!null")!), false);
    assert.equal(casaCondicion("x", parseCondicion("!null")!), true);
  });
});

/* ─── filtrado sobre filas ────────────────────────────────────────────────── */

const FILAS = [
  { id: 1, nombre: "Ana", nota: null },
  { id: 2, nombre: "Bea", nota: "10" },
  { id: 3, nombre: "Carla", nota: "9" },
  { id: 4, nombre: "ana María", nota: null },
  { id: 5, nombre: "Dora", nota: "" },
];

describe("filtrarIndices", () => {
  test("sin condiciones devuelve todas, en orden", () => {
    assert.deepEqual(filtrarIndices(FILAS, []), [0, 1, 2, 3, 4]);
  });

  test("devuelve índices del array ORIGINAL, no posiciones correlativas", () => {
    // La invariante que sostiene la fase: el contenedor guarda los cambios pendientes contra la
    // posición original, así que devolver [0,1] aquí reapuntaría cada edición a otra fila.
    const indices = filtrarIndices(FILAS, parsearFiltros({ nombre: "ana" }));
    assert.deepEqual(indices, [0, 3]);
  });

  test("varias columnas se combinan con AND", () => {
    assert.deepEqual(filtrarIndices(FILAS, parsearFiltros({ nombre: "a", nota: "9" })), [2]);
    assert.deepEqual(filtrarIndices(FILAS, parsearFiltros({ nombre: "a", nota: "10" })), [1]);
  });

  test("una columna sin filtro no descarta a nadie", () => {
    // El filtro de `nota` es espacios: no es un filtro. Sólo manda el de `nombre`.
    assert.deepEqual(filtrarIndices(FILAS, parsearFiltros({ nombre: "bea", nota: "  " })), [1]);
  });

  test("siempreVisibles pasa sin evaluarse (D4)", () => {
    // Una fila con cambios sin guardar se enseña aunque no case: filtrar no puede llevarse por
    // delante una edición que el usuario todavía no confirmó.
    const indices = filtrarIndices(
      FILAS,
      parsearFiltros({ nombre: "zzz" }),
      new Set([1, 4])
    );
    assert.deepEqual(indices, [1, 4]);
  });

  test("siempreVisibles mantiene el orden original", () => {
    const indices = filtrarIndices(FILAS, parsearFiltros({ nota: "0" }), new Set([0, 4]));
    assert.deepEqual(indices, [0, 1, 4]);
  });

  test("no se sale de rango ni se atraganta con filas ausentes", () => {
    // El hueco (índice 1) se salta y NO se cuela en el resultado: devolver índices que apuntan a
    // una fila que no existe haría que la rejilla pintara una fila fantasma en blanco.
    const conHueco = [FILAS[0], undefined as unknown as Record<string, unknown>, FILAS[2]];
    const indices = filtrarIndices(conHueco, parsearFiltros({ nombre: "a" }));
    assert.deepEqual(indices, [0, 2]);
    assert.ok(!indices.includes(1), "el índice del hueco no aparece");
  });
});

describe("firmaDeColumnas (T4: cuándo se tiran los filtros)", () => {
  test("mismas columnas, misma firma: refrescar, paginar o aplicar un WHERE conservan el filtro", () => {
    const a = [{ name: "id" }, { name: "nombre" }];
    assert.equal(firmaDeColumnas(a), firmaDeColumnas([{ name: "id" }, { name: "nombre" }]));
  });

  test("otras columnas u otro orden, otra firma", () => {
    assert.notEqual(firmaDeColumnas([{ name: "id" }]), firmaDeColumnas([{ name: "id" }, { name: "x" }]));
    assert.notEqual(firmaDeColumnas([{ name: "a" }, { name: "b" }]), firmaDeColumnas([{ name: "b" }, { name: "a" }]));
  });

  test("el separador no puede fabricar una colisión con nombres normales", () => {
    // Con "," como separador, ["a,b"] y ["a","b"] darían la misma firma.
    assert.notEqual(firmaDeColumnas([{ name: "a,b" }]), firmaDeColumnas([{ name: "a" }, { name: "b" }]));
  });
});

describe("hayFiltro", () => {
  test("distingue «sin filtros» de «filtro vacío escrito»", () => {
    // De esto depende que el contador diga «3 de 5 filas» sólo cuando de verdad hay un filtro.
    assert.equal(hayFiltro({}), false);
    assert.equal(hayFiltro({ nombre: "", nota: "   " }), false);
    assert.equal(hayFiltro({ nombre: "" , nota: "9" }), true);
  });
});

describe("rendimiento: filtrar antes de ordenar (fase 13)", () => {
  test("100 000 filas no se convierten en un problema cuadrático", () => {
    // El tope por defecto son 100 000 filas (DEFAULT_MAX_ROWS), y el filtro corre en cada pulsación.
    // Esta cota es DELIBERADAMENTE holgada: caza un O(n²) accidental (que con 100 000 filas tarda
    // minutos), no una regresión de milisegundos.
    const filas = Array.from({ length: 100_000 }, (_, i) => ({
      id: i,
      nombre: `nombre-${i}`,
      nota: i % 7 === 0 ? null : String(i),
    }));
    const condiciones = parsearFiltros({ nombre: "nombre-99", nota: "!null" });

    const inicio = performance.now();
    const indices = filtrarIndices(filas, condiciones);
    const ms = performance.now() - inicio;

    assert.ok(indices.length > 0, "el filtro no debe vaciar la rejilla con datos que casan");
    assert.ok(ms < 3_000, `filtrar 100 000 filas tardó ${Math.round(ms)} ms`);
  });
});
