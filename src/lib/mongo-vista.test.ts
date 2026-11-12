import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAXIMO_DE_VISTAS, crearCacheDeVistas, type VistaDeColeccion } from "@/lib/mongo-vista";

/**
 * R100 (T1) — caché por pestaña de la vista de documentos de Mongo. Aquí se fija lo que puede
 * romperse en silencio: que dos pestañas no se mezclen, que escribir dos veces pise con lo último,
 * y sobre todo la política LRU (con el caché lleno se descarta EL MÁS VIEJO, y leer cuenta como
 * «usar» y salva de la expulsión).
 */

/** Una vista de ejemplo con lo justo para distinguir una pestaña de otra. */
function vistaDe(filtro: string): VistaDeColeccion {
  return {
    filtro,
    proyeccion: "",
    orden: "",
    opcionesAbiertas: false,
    aplicado: { filtro, proyeccion: "", orden: "" },
    pagina: 0,
    porPagina: 25,
    vista: "lista",
    resultado: null,
    borradores: {},
    erroresDoc: {},
  };
}

describe("crearCacheDeVistas", () => {
  test("leer de una pestaña vacía da undefined", () => {
    const cache = crearCacheDeVistas();
    assert.equal(cache.leer("no-existe"), undefined);
    assert.equal(cache.tamano(), 0);
  });

  test("escribir + leer devuelve lo mismo", () => {
    const cache = crearCacheDeVistas();
    const vista = vistaDe("{a: 1}");
    cache.escribir("p1", vista);
    assert.equal(cache.leer("p1"), vista);
    assert.equal(cache.tamano(), 1);
  });

  test("dos pestañas no se mezclan", () => {
    const cache = crearCacheDeVistas();
    cache.escribir("pestana-a", vistaDe("{a: 1}"));
    cache.escribir("pestana-b", vistaDe("{b: 2}"));
    assert.equal(cache.leer("pestana-a")?.filtro, "{a: 1}");
    assert.equal(cache.leer("pestana-b")?.filtro, "{b: 2}");
  });

  test("escribir dos veces la misma pestaña pisa con lo último", () => {
    const cache = crearCacheDeVistas();
    cache.escribir("p1", vistaDe("viejo"));
    cache.escribir("p1", vistaDe("nuevo"));
    assert.equal(cache.leer("p1")?.filtro, "nuevo");
    assert.equal(cache.tamano(), 1, "pisar no crea una segunda entrada");
  });

  test("LRU por escritura: con máximo 3, la cuarta pestaña expulsa a la primera", () => {
    const cache = crearCacheDeVistas(3);
    cache.escribir("p1", vistaDe("1"));
    cache.escribir("p2", vistaDe("2"));
    cache.escribir("p3", vistaDe("3"));
    cache.escribir("p4", vistaDe("4"));
    assert.equal(cache.leer("p1"), undefined, "p1 es la más vieja: fuera");
    assert.equal(cache.tamano(), 3);
    assert.equal(cache.leer("p4")?.filtro, "4");
  });

  test("LRU por lectura: leer a la salva cuando llega c", () => {
    const cache = crearCacheDeVistas(2);
    cache.escribir("a", vistaDe("a"));
    cache.escribir("b", vistaDe("b"));
    assert.notEqual(cache.leer("a"), undefined, "leer a la mueve al final (más reciente)");
    cache.escribir("c", vistaDe("c"));
    assert.notEqual(cache.leer("a"), undefined, "a sobrevivió: se leyó justo antes");
    assert.equal(cache.leer("b"), undefined, "b era la menos usada: fuera");
    assert.equal(cache.tamano(), 2);
  });

  test("olvidar quita la vista y tamano baja", () => {
    const cache = crearCacheDeVistas();
    cache.escribir("p1", vistaDe("1"));
    cache.escribir("p2", vistaDe("2"));
    cache.olvidar("p1");
    assert.equal(cache.leer("p1"), undefined);
    assert.equal(cache.tamano(), 1);
    // Olvidar lo que no existe no rompe ni cambia el tamaño.
    cache.olvidar("fantasma");
    assert.equal(cache.tamano(), 1);
  });

  test("MAXIMO_DE_VISTAS es 12 y es el máximo por defecto", () => {
    assert.equal(MAXIMO_DE_VISTAS, 12);
    const cache = crearCacheDeVistas();
    for (let i = 0; i < 20; i++) cache.escribir(`p${i}`, vistaDe(`${i}`));
    assert.equal(cache.tamano(), MAXIMO_DE_VISTAS);
  });
});
