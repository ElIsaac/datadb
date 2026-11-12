import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWritableIfNeeded, isReadOnlyStatement, ReadOnlyViolationError } from "./read-only-guard";

/*
 * Casos del guard de solo lectura. Los marcados "HUECO" pasaban con la versión anterior (que solo miraba la
 * primera palabra) y se verificaron contra Postgres 16 real el 2026-10-09: `SELECT 1; DELETE FROM clientes`
 * borró todas las filas en una conexión marcada como solo lectura.
 */

const PERMITIDAS: [string, string | undefined][] = [
  ["SELECT * FROM clientes", undefined],
  ["select id from clientes;", undefined],
  ["-- nota\nSELECT count(*) FROM clientes", undefined], // bug reportado: el comentario inicial bloqueaba
  ["/* bloque */ SELECT 1", undefined],
  ["-- a\n-- b\n  /* c */\nWITH t AS (SELECT 1) SELECT * FROM t", undefined],
  ["SELECT 'DELETE FROM x' AS texto", undefined], // palabras de escritura dentro de un literal
  ["SELECT \"update\" FROM t", "postgres"], // identificador entre comillas
  ["SELECT `delete` FROM t", "mysql"],
  ["SELECT [drop] FROM t", "sqlserver"],
  ["SELECT created_at, last_update, deleted FROM t", undefined], // sin falsos positivos por subcadena
  ["SELECT comment, load, lock FROM posts", undefined], // nombres de columna habituales
  ["SELECT 1; SELECT 2", undefined],
  ["EXPLAIN SELECT * FROM t", undefined],
  ["SHOW TABLES", "mysql"],
  ["SELECT $$texto con ; y DELETE$$", "postgres"],
  ["SELECT E'a\\'b'", "postgres"],
  ["", undefined],
  ["  ;  ", undefined],
];

const BLOQUEADAS: [string, string | undefined, string][] = [
  ["SELECT 1; DELETE FROM clientes", "postgres", "HUECO: segunda sentencia"],
  ["WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x", "postgres", "HUECO: CTE que modifica datos"],
  ["SELECT * INTO copia FROM t", "postgres", "HUECO: SELECT INTO crea una tabla"],
  ["SELECT 1 DELETE FROM t", "sqlserver", "SQL Server ejecuta sentencias sin ';'"],
  ["EXPLAIN ANALYZE DELETE FROM t", "postgres", "EXPLAIN ANALYZE ejecuta la sentencia"],
  ["UPDATE t SET a = 1", undefined, "escritura directa"],
  ["-- nota\nDELETE FROM t", undefined, "escritura tras comentario"],
  ["/*!50000 DROP TABLE t */ SELECT 1", "mysql", "MySQL ejecuta los comentarios /*! */"],
  ["SELECT 'a\\'; DELETE FROM t; --'", "postgres", "en PG el \\ no escapa: el DELETE se ejecuta"],
  ["SELECT 'a\\'' , 'x' ; DELETE FROM t", "mysql", "en MySQL el \\ sí escapa: desincroniza comillas"],
  ["SELECT $$'$$; DELETE FROM t; --'", "postgres", "comillas dentro de $$ no abren literal"],
  ["SELECT 1 --x; DELETE FROM t", "mysql", "en MySQL '--' sin espacio no es comentario"],
  ["SELECT 1 # nota ; DELETE FROM t", "postgres", "en PG '#' no es comentario"],
  ["SELECT 'sin cerrar", undefined, "literal sin cerrar: no se puede analizar con seguridad"],
  ["SELECT 1 /* sin cerrar", undefined, "comentario sin cerrar"],
  ["CALL proc()", undefined, "procedimiento"],
  ["SELECT 1; EXEC xp_cmdshell 'dir'", "sqlserver", "EXEC"],
  ["COPY t TO '/tmp/x'", "postgres", "COPY"],
  ["SET default_transaction_read_only = off", "postgres", "SET no es de lectura"],
  ["SELECT 1 KILL 52", "sqlserver", "comando de SQL Server sin ';'"],
  ["COMMENT ON TABLE t IS 'x'", "postgres", "COMMENT ON como sentencia"],
];

for (const [sql, engine] of PERMITIDAS) {
  test(`permite (${engine ?? "cualquier motor"}): ${JSON.stringify(sql)}`, () => {
    assert.equal(isReadOnlyStatement(sql, engine), true);
  });
}

for (const [sql, engine, why] of BLOQUEADAS) {
  test(`bloquea (${engine ?? "cualquier motor"}) — ${why}: ${JSON.stringify(sql)}`, () => {
    assert.equal(isReadOnlyStatement(sql, engine), false);
    // Sin motor (uso en el cliente) también se bloquea: se prueban todas las interpretaciones.
    assert.equal(isReadOnlyStatement(sql), false);
  });
}

test("el mensaje de error nombra lo que se bloqueó, no el comentario inicial", () => {
  assert.throws(
    () => assertWritableIfNeeded("-- borrar\nDELETE FROM t", true, "postgres"),
    (e: unknown) => e instanceof ReadOnlyViolationError && /DELETE/.test(e.message) && !/"--"/.test(e.message)
  );
});

test("sin modo solo lectura no se bloquea nada", () => {
  assert.doesNotThrow(() => assertWritableIfNeeded("DROP TABLE t", false));
  assert.doesNotThrow(() => assertWritableIfNeeded("DROP TABLE t", undefined));
});

/*
 * Fase 13 (T5): el `WHERE` y el `ORDER BY` de la vista de tabla se CONCATENAN al SQL que se ejecuta
 * (`table-view-tab.tsx`, `buildQuery`: el `WHERE` entra entre paréntesis, el `ORDER BY` entra SIN
 * paréntesis). El guard recibe esa sentencia ya construida — esto se midió el 2026-10-12 contra
 * Postgres real y con un perfil `readOnly`, y aquí se fija para que no se pierda por el camino.
 *
 * Cómo se midió (importa, porque un "no pasó nada" no prueba nada por sí solo): el payload se metió
 * por el campo `ORDER BY` de la UI, y el error que devolvió el worker fue el DEL GUARD
 * (`ReadOnlyViolationError: … no se permite ejecutar "DELETE"`), no el de la transacción de solo
 * lectura de Postgres — o sea que el guard lo vio. El CONTROL fue el mismo SQL contra una conexión de
 * escritura: ahí sí borró (`affectedRows: 1`) y la fila canaria desapareció. Es decir, el payload es
 * un exploit real y lo único que lo paró en solo lectura fue el guard.
 *
 * Los payloads llevan `; --` a propósito: `applyLimit` concatena `LIMIT n` al FINAL de la sentencia,
 * así que sin el comentario el resultado sería `DELETE … LIMIT n`, que Postgres rechaza por sintaxis
 * —y entonces el intento moriría por sintaxis y no por el guard, que es justo la confusión que hay
 * que evitar. En MySQL `DELETE … LIMIT` SÍ es válido: allí el mismo texto es un borrado real sin
 * necesidad del comentario, y el guard es la única barrera.
 */
const CONCATENADAS_POR_LA_VISTA_DE_TABLA: [string, boolean, string][] = [
  [
    `SELECT * FROM "public"."clientes" ORDER BY id; DELETE FROM clientes WHERE id = 9999; --`,
    false,
    "ORDER BY sin paréntesis, con el LIMIT de `applyLimit` comentado",
  ],
  [
    `SELECT * FROM "public"."clientes" ORDER BY id; DELETE FROM clientes WHERE id = 9999`,
    false,
    "ORDER BY sin paréntesis (sin el comentario)",
  ],
  [
    `SELECT * FROM "public"."clientes" WHERE (1=1); DELETE FROM clientes WHERE id = 9999; --)`,
    false,
    "WHERE entre paréntesis: se cierran y se sigue escribiendo",
  ],
  [
    `SELECT * FROM "public"."clientes" ORDER BY id; DROP TABLE pedidos`,
    false,
    "DDL por el campo ORDER BY",
  ],
  [
    `SELECT * FROM "public"."clientes" ORDER BY id UPDATE clientes SET nombre = 'x'`,
    false,
    "sin `;`: palabra de escritura en cualquier posición (SQL Server la ejecutaría)",
  ],
  [
    `SELECT * FROM "public"."clientes" ORDER BY (select 1) /*! DELETE FROM clientes WHERE id = 9999 */`,
    false,
    "comentario ejecutable de MySQL colado por el ORDER BY",
  ],
  [
    `SELECT * FROM "public"."clientes" ORDER BY id`,
    true,
    "lectura legítima: no se puede bloquear por tener un campo de texto libre",
  ],
  [
    `SELECT * FROM "public"."clientes" WHERE (ciudad = 'Juarez')`,
    true,
    "filtro legítimo de la vista de tabla",
  ],
];

for (const [sql, permitida, why] of CONCATENADAS_POR_LA_VISTA_DE_TABLA) {
  test(`vista de tabla (T5) — ${permitida ? "permite" : "bloquea"} — ${why}`, () => {
    // Se llama como lo llama el worker: `assertWritableIfNeeded(sql, session.readOnly, session.type)`.
    if (permitida) assert.doesNotThrow(() => assertWritableIfNeeded(sql, true, "postgres"));
    else assert.throws(() => assertWritableIfNeeded(sql, true, "postgres"), ReadOnlyViolationError);
  });
}
