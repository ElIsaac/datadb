import { test } from "node:test";
import assert from "node:assert/strict";
import { getActiveStatement, getStatementRangeAt, splitStatements } from "@/lib/sql-statements";

/**
 * Sentencia bajo el cursor (contorno verde de la consola, pedido del usuario 2026-10-21 con capturas
 * de DataGrip): con `;`, sin `;` (línea en blanco + palabra de sentencia) y NINGUNA cuando el cursor
 * está entre dos. El cursor se marca con `│`.
 */
function rango(conCursor: string): string | null {
  const pos = conCursor.indexOf("│");
  const text = conCursor.replace("│", "");
  const r = getStatementRangeAt(text, pos);
  return r ? text.slice(r.from, r.to) : null;
}

const DOC = [
  "select *", //            línea 0
  "from banks_deposits_bankdeposit",
  "where id =11977583;",
  "",
  "select *",
  "from banks_deposits_bankdeposit",
  "where id = 11955047",
  "",
  "SELECT * FROM deposits_depositbankclient",
  "WHERE bank_deposit_id = 11964855;",
].join("\n");

const en = (linea: number, col: number) => {
  const lines = DOC.split("\n");
  let pos = 0;
  for (let i = 0; i < linea; i++) pos += lines[i].length + 1;
  pos += col;
  return DOC.slice(0, pos) + "│" + DOC.slice(pos);
};

test("con `;`: la sentencia entera, con su `;`", () => {
  assert.equal(rango(en(1, 4)), "select *\nfrom banks_deposits_bankdeposit\nwhere id =11977583;");
  // Justo detrás del `;` se sigue en ella.
  assert.equal(rango(en(2, 19)), "select *\nfrom banks_deposits_bankdeposit\nwhere id =11977583;");
});

test("sin `;`: la línea en blanco + SELECT cierra la sentencia de arriba", () => {
  assert.equal(rango(en(5, 3)), "select *\nfrom banks_deposits_bankdeposit\nwhere id = 11955047");
  // Al final de la última línea (sin `;`) también.
  assert.equal(rango(en(6, 19)), "select *\nfrom banks_deposits_bankdeposit\nwhere id = 11955047");
  assert.equal(rango(en(8, 0)), "SELECT * FROM deposits_depositbankclient\nWHERE bank_deposit_id = 11964855;");
});

test("entre dos sentencias no hay ninguna", () => {
  assert.equal(rango(en(3, 0)), null); // blanco tras un `;`
  assert.equal(rango(en(7, 0)), null); // blanco entre dos sin `;`
  assert.equal(rango("select 1;   │"), null); // espacios detrás del `;`
  assert.equal(rango("│"), null);
});

test("no corta lo que sigue a medias, ni dentro de paréntesis, cadenas o bloques", () => {
  const union = "select 1\nunion all\n\nselect 2│";
  assert.equal(rango(union), "select 1\nunion all\n\nselect 2");
  const sub = "select * from t where id in (\n\n  select id from u│\n)";
  assert.equal(rango(sub), "select * from t where id in (\n\n  select id from u\n)");
  const cadena = "select 'a\n\nselect b' as x│";
  assert.equal(rango(cadena), "select 'a\n\nselect b' as x");
  // Un bloque `BEGIN … END` sin `;` dentro: no se parte por sus líneas en blanco. (Hueco conocido,
  // anterior a esta fase: los buscadores de `;` no conocen las cadenas dólar de Postgres, así que un
  // `$$ … ; … $$` sí se parte en el `;` de dentro.)
  const bloque = "begin\n  update t set a = 1\n\n  select 1\nend│";
  assert.equal(rango(bloque), bloque.replace("│", ""));
});

test("⌘⏎ ejecuta la misma sentencia que se contornea (también sin `;`)", () => {
  const text = DOC;
  const pos = en(5, 3).indexOf("│");
  assert.equal(getActiveStatement(text, pos), "select *\nfrom banks_deposits_bankdeposit\nwhere id = 11955047");
});

test("«Todo» separa también las sentencias sin `;`", () => {
  assert.deepEqual(splitStatements(DOC), [
    "select *\nfrom banks_deposits_bankdeposit\nwhere id =11977583",
    "select *\nfrom banks_deposits_bankdeposit\nwhere id = 11955047",
    "SELECT * FROM deposits_depositbankclient\nWHERE bank_deposit_id = 11964855",
  ]);
  // Con DELIMITER propio no se parte por líneas en blanco (cuerpos de rutina).
  const rutina = "DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n\nSELECT 1;\nEND$$\nDELIMITER ;";
  assert.equal(splitStatements(rutina).length, 1);
});
