/**
 * Coloreado del editor propio — lexer SQL propio, sin CodeMirror ni Lezer.
 *
 * HISTORIA: hasta hoy el coloreado llamaba al parser de `@codemirror/lang-sql` y mapeaba sus tags
 * con `@lezer/highlight`. Funcionaba, pero arrastraba la dependencia entera de CodeMirror solo para
 * pintar. El usuario pidió quedarse con el editor propio y quitar CodeMirror (2026-10-20), así que
 * el coloreado pasa a ser un lexer propio: sin dependencias y con tests.
 *
 * QUÉ PINTA: exactamente las mismas clases que antes (`ld-kw`, `ld-str`, `ld-num`, `ld-com`,
 * `ld-fn`, `ld-type`, `ld-var`, `ld-op`), y el color lo sigue poniendo el tema en CSS con los
 * tokens `--gdb-*`. Nada de colores literales aquí.
 *
 * QUÉ SE PIERDE frente a un parser completo: el lexer no entiende gramática, así que una palabra
 * que sea clave en otro contexto (`name` como columna) se pinta como clave si está en la lista.
 * Es el mismo compromiso que aceptan los editores ligeros y no afecta a la ejecución.
 *
 * El comentario de bloque SÍ cruza líneas: el estado se arrastra entre las líneas del bloque
 * visible. Un documento que se abra en medio de un `/* … *\/` pinta el resto de esa línea como
 * comentario hasta el cierre, que es exactamente lo que hacía el parser sobre la ventana.
 */

/** Un tramo con color, en coordenadas de SU línea. */
export interface Token {
  from: number;
  to: number;
  cls: string;
}

export type Dialecto = "postgres" | "mysql" | "standard";

/**
 * Palabras clave. Una sola lista para los tres dialectos a propósito: el resaltado no necesita
 * precisión de gramática y una tabla por motor serían tres listas que se desincronizan. Las que
 * solo existen en uno (ILIKE en Postgres, LIMIT/OFFSET en MySQL…) se pintan igual en ambos.
 */
const CLAVES = new Set(
  (
    "ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMENT " +
    "COMMIT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE " +
    "DEFAULT DELETE DESC DISTINCT DO DROP ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FIRST " +
    "FOR FOREIGN FROM FULL FUNCTION GRANT GROUP HAVING IF ILIKE IN INDEX INNER INSERT INTERSECT " +
    "INTO IS JOIN KEY LAST LEFT LIKE LIMIT NATURAL NEXT NOT NULL NULLS OFFSET ON ONLY OR ORDER " +
    "OUTER OVER PARTITION PRIMARY PROCEDURE RAW REFERENCES RETURNING RETURNS RIGHT ROLLBACK ROW " +
    "ROWS SCHEMA SELECT SET SHOW TABLE TEMP TEMPORARY THEN TO TRANSACTION TRIGGER TRUE TRUNCATE " +
    "UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WINDOW WITH"
  ).split(" ")
);

/** Tipos de dato: se pintan distinto de una columna cualquiera. */
const TIPOS = new Set(
  (
    "BIGINT BIGSERIAL BINARY BIT BLOB BOOL BOOLEAN BYTEA CHAR CHARACTER CLOB DATE DATETIME DECIMAL " +
    "DOUBLE ENUM FLOAT INT INTEGER INTERVAL JSON JSONB LONG MEDIUMINT MONEY NUMERIC REAL SERIAL " +
    "SMALLINT TEXT TIME TIMESTAMP TIMESTAMPTZ TINYINT UUID VARBINARY VARCHAR YEAR"
  ).split(" ")
);

const esLetra = (c: string) => /[A-Za-z_]/.test(c);
const esAlfanum = (c: string) => /[A-Za-z0-9_$]/.test(c);
const esDigito = (c: string) => c >= "0" && c <= "9";

/**
 * Colorea un bloque de líneas. Devuelve, por línea, sus tramos con clase. Las líneas sin tramos
 * vuelven vacías y el componente las pinta con el color de texto normal.
 */
/**
 * Lo que el lexer necesita SABER del esquema para pintar columnas. Sin esto pinta todo igual: el
 * lexer no consulta la base, se lo pasa quien sí la conoce (la consola).
 */
export interface NombresConocidos {
  /** Nombres de columna en minúsculas, de todo el esquema conectado. */
  columnas?: ReadonlySet<string>;
  /** Nombres de tabla en minúsculas: si una palabra es las dos cosas, se pinta como tabla. */
  tablas?: ReadonlySet<string>;
}

export function highlightLines(
  lines: readonly string[],
  dialecto: Dialecto = "standard",
  conocidos: NombresConocidos = {}
): Token[][] {
  const salida: Token[][] = lines.map(() => []);
  // Estado que cruza líneas: si la línea anterior dejó un comentario /* abierto.
  let enBloque = false;
  const conBackslash = dialecto === "mysql";

  for (let ln = 0; ln < lines.length; ln++) {
    const texto = lines[ln];
    const tokens = salida[ln];
    let i = 0;

    while (i < texto.length) {
      // Dentro de un comentario de bloque abierto en una línea anterior.
      if (enBloque) {
        const fin = texto.indexOf("*/", i);
        if (fin === -1) {
          tokens.push({ from: i, to: texto.length, cls: "ld-com" });
          i = texto.length;
        } else {
          tokens.push({ from: i, to: fin + 2, cls: "ld-com" });
          i = fin + 2;
          enBloque = false;
        }
        continue;
      }

      const c = texto[i];

      // Espacios: no generan token.
      if (c === " " || c === "\t" || c === "\r") {
        i++;
        continue;
      }

      // Comentario de línea: -- hasta el final (en MySQL también #).
      if ((c === "-" && texto[i + 1] === "-") || (c === "#" && dialecto === "mysql")) {
        tokens.push({ from: i, to: texto.length, cls: "ld-com" });
        i = texto.length;
        continue;
      }

      // Comentario de bloque: puede cerrarse en esta línea o seguir en la siguiente.
      if (c === "/" && texto[i + 1] === "*") {
        const fin = texto.indexOf("*/", i + 2);
        if (fin === -1) {
          tokens.push({ from: i, to: texto.length, cls: "ld-com" });
          enBloque = true;
          i = texto.length;
        } else {
          tokens.push({ from: i, to: fin + 2, cls: "ld-com" });
          i = fin + 2;
        }
        continue;
      }

      // Cadena: 'texto''con comillas' (SQL estándar) y en MySQL además \' .
      if (c === "'") {
        let j = i + 1;
        while (j < texto.length) {
          if (texto[j] === "\\" && conBackslash) {
            j += 2;
            continue;
          }
          if (texto[j] === "'") {
            if (texto[j + 1] === "'") {
              j += 2;
              continue;
            }
            j++;
            break;
          }
          j++;
        }
        tokens.push({ from: i, to: Math.min(j, texto.length), cls: "ld-str" });
        i = j;
        continue;
      }

      // Identificador entre comillas dobles (Postgres) o backticks (MySQL): es un identificador,
      // no una cadena, y se pinta como tal.
      if (c === '"' || c === "`") {
        const cierre = texto.indexOf(c, i + 1);
        const fin = cierre === -1 ? texto.length : cierre + 1;
        tokens.push({ from: i, to: fin, cls: "ld-var" });
        i = fin;
        continue;
      }

      // Números: enteros, decimales y exponente. También $1 (parámetro de Postgres).
      if (esDigito(c) || (c === "$" && esDigito(texto[i + 1]))) {
        let j = i + 1;
        while (j < texto.length) {
          const d = texto[j];
          if (esDigito(d) || d === ".") {
            j++;
            continue;
          }
          if ((d === "e" || d === "E") && esDigito(texto[j + 1])) {
            j++;
            continue;
          }
          if ((d === "+" || d === "-") && /[eE]/.test(texto[j - 1])) {
            j++;
            continue;
          }
          break;
        }
        tokens.push({ from: i, to: j, cls: "ld-num" });
        i = j;
        continue;
      }

      // Identificador o palabra clave.
      if (esLetra(c)) {
        let j = i + 1;
        while (j < texto.length && esAlfanum(texto[j])) j++;
        const palabra = texto.slice(i, j);
        const arriba = palabra.toUpperCase();
        // Función: el identificador va seguido de «(» (ignorando espacios).
        let k = j;
        while (k < texto.length && (texto[k] === " " || texto[k] === "\t")) k++;
        /*
          Columna: la palabra ES una columna conocida del esquema. Dos reglas, en este orden:
          - `alias.columna` (hay un punto antes) → es un miembro, así que se pinta como columna
            aunque exista una tabla con ese nombre.
          - suelta: se pinta como columna solo si NO es además el nombre de una tabla; si lo es, se
            queda como estaba (tabla), que es lo que pidió el usuario: la tabla y el alias no cambian.
        */
        let atras = i - 1;
        while (atras >= 0 && (texto[atras] === " " || texto[atras] === "\t")) atras--;
        const esMiembro = texto[atras] === ".";
        const minuscula = palabra.toLowerCase();
        const esColumna =
          Boolean(conocidos.columnas?.has(minuscula)) && (esMiembro || !conocidos.tablas?.has(minuscula));
        const cls = CLAVES.has(arriba)
          ? "ld-kw"
          : TIPOS.has(arriba)
            ? "ld-type"
            : texto[k] === "("
              ? "ld-fn"
              : esColumna
                ? "ld-col"
                : "ld-var";
        tokens.push({ from: i, to: j, cls });
        i = j;
        continue;
      }

      // Operadores y puntuación, agrupados para no generar un token por carácter.
      let j = i + 1;
      while (j < texto.length && /[(),.;+*/%<>=!|&:-]/.test(texto[j])) j++;
      tokens.push({ from: i, to: j, cls: "ld-op" });
      i = j;
    }
  }

  return salida;
}
