/**
 * Normalizador de la barra de consulta de MongoDB (fase 81).
 *
 * POR QUÉ EXISTE: el usuario pidió una vista «similar a MongoDB Compass», y en Compass se escribe
 * `{ name: "cuenta", edad: { $gt: 30 } }` — claves SIN comillas y constructores del shell
 * (`ObjectId("…")`, `ISODate("…")`). Eso NO es JSON y `EJSON.parse` lo rechaza con
 * «Expected property name»: si se dejara así, la barra parecería rota en el primer intento de
 * cualquiera que venga de Compass.
 *
 * QUÉ HACE: convierte ese texto a JSON estricto (que es lo que come `EJSON.parse`) sin tocar lo que
 * va dentro de las cadenas:
 *   - comillas simples → dobles,
 *   - claves sin comillas → `"clave"`,
 *   - `ObjectId("x")` → `{"$oid":"x"}`, `ISODate("x")`/`new Date("x")` → `{"$date":"x"}`,
 *     `NumberLong(7)` → `{"$numberLong":"7"}`, `NumberDecimal("1.5")` → `{"$numberDecimal":"1.5"}`,
 *     `NumberInt(7)` → `7`.
 * Lo que no reconoce se deja tal cual: el error de `EJSON.parse` sigue siendo el que informa, y así
 * no se inventa una sintaxis que el driver no va a entender.
 */

/** Quita las comillas (simples o dobles) que envuelven el argumento de un constructor. */
const sinComillas = (a: string) => a.trim().replace(/^["']|["']$/g, "");

const CONSTRUCTORES: Record<string, (arg: string) => string> = {
  ObjectId: (a) => `{"$oid":${JSON.stringify(sinComillas(a))}}`,
  ISODate: (a) => `{"$date":${JSON.stringify(sinComillas(a))}}`,
  NumberLong: (a) => `{"$numberLong":${JSON.stringify(sinComillas(a))}}`,
  NumberDecimal: (a) => `{"$numberDecimal":${JSON.stringify(sinComillas(a))}}`,
  // `NumberInt` es un entero normal en BSON: se deja como número.
  NumberInt: (a) => sinComillas(a),
};

/** Convierte `'texto'` en `"texto"` escapando las comillas dobles que llevara dentro. */
function comillasDobles(contenido: string): string {
  return `"${contenido.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Normaliza el texto escrito por el usuario. Nunca lanza: si algo no se entiende, se devuelve igual
 * y el parser dirá dónde está el problema.
 */
export function normalizarConsulta(texto: string): string {
  const s = texto ?? "";
  let salida = "";
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    // --- Cadenas -----------------------------------------------------------
    if (c === '"') {
      const inicio = i;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") i += 2;
        else if (s[i] === '"') {
          i++;
          break;
        } else i++;
      }
      salida += s.slice(inicio, i);
      continue;
    }
    if (c === "'") {
      i++;
      let contenido = "";
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\") {
          contenido += s[i + 1] ?? "";
          i += 2;
        } else contenido += s[i++];
      }
      i++; // cierre
      salida += comillasDobles(contenido);
      continue;
    }

    // --- Identificadores: claves sin comillas y constructores ---------------
    if (/[A-Za-z_$]/.test(c)) {
      const inicio = i;
      while (i < s.length && /[\w$]/.test(s[i])) i++;
      const palabra = s.slice(inicio, i);
      const anterior = salida.trimEnd().slice(-1);
      const siguiente = s.slice(i).match(/^\s*(.)/)?.[1] ?? "";

      // Constructor: `ObjectId("…")`, `new Date("…")`, `NumberLong(7)`…
      const esNewDate = palabra === "new" && /^\s*Date\s*\(/.test(s.slice(i));
      const ctor = esNewDate ? "ISODate" : palabra;
      if (esNewDate || (CONSTRUCTORES[ctor] && siguiente === "(")) {
        let j = i;
        if (esNewDate) {
          j = s.indexOf("Date", i);
          j = s.indexOf("(", j);
        } else {
          j = s.indexOf("(", i);
        }
        const cierre = s.indexOf(")", j);
        if (j > -1 && cierre > -1) {
          const arg = s.slice(j + 1, cierre).trim();
          salida += CONSTRUCTORES[ctor](arg);
          i = cierre + 1;
          continue;
        }
      }

      // Clave de objeto sin comillas: va después de `{` o `,` y antes de `:`.
      const esClave = (anterior === "{" || anterior === ",") && siguiente === ":";
      salida += esClave ? JSON.stringify(palabra) : palabra;
      continue;
    }

    salida += c;
    i++;
  }

  return salida;
}
