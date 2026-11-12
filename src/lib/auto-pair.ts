/**
 * Auto-cierre de llaves, corchetes, paréntesis y comillas para los campos de consulta (fase 82).
 *
 * PEDIDO DEL USUARIO: «al escribir la llave { solo se escribe esta, no la cierra». En una barra donde
 * todo se escribe entre llaves, teclear siempre el cierre es la mitad del trabajo.
 *
 * LAS TRES REGLAS (las mismas de un editor decente, no solo «añadir el cierre»):
 *  1. **Abrir**: se inserta el par y el cursor queda EN MEDIO.
 *  2. **Cerrar**: si el carácter ya está justo delante del cursor, NO se duplica: el cursor pasa por
 *     encima. Sin esto, después de auto-cerrar, teclear `}` deja `}}` y hay que borrar.
 *  3. **Borrar**: con el cursor entre un par vacío (`{|}`), ⌫ borra los dos.
 *
 * Además: si hay texto seleccionado y se escribe una apertura, se ENVUELVE la selección (lo que
 * espera cualquiera que selecciona una palabra y escribe una comilla).
 *
 * Todo es puro y sin DOM: recibe el valor, la selección y la tecla, y devuelve el valor nuevo con la
 * posición del cursor. Así se prueba sin ventana.
 */

const PARES: Record<string, string> = {
  "{": "}",
  "[": "]",
  "(": ")",
  '"': '"',
};

const CIERRES = new Set(Object.values(PARES));

/** Alfanumérico: sirve para no auto-cerrar una comilla pegada a una palabra (`abc"`). */
const esPalabra = (c: string | undefined) => !!c && /[\w$]/.test(c);

export interface EdicionDeTexto {
  valor: string;
  /** Posición del cursor al terminar (índice de carácter). */
  cursor: number;
}

/**
 * Apertura tecleada. Devuelve `null` si no hay nada que hacer (dejar que el campo se comporte normal).
 *
 * La comilla es el único caso con una excepción: si el cursor está pegado a una palabra por la
 * izquierda, NO se cierra (se está cerrando una cadena abierta antes, no abriendo una nueva).
 */
export function alAbrir(
  valor: string,
  inicio: number,
  fin: number,
  caracter: string
): EdicionDeTexto | null {
  const cierre = PARES[caracter];
  if (!cierre) return null;

  const seleccion = valor.slice(inicio, fin);
  if (caracter === '"' && !seleccion && esPalabra(valor[inicio - 1])) return null;

  // Con selección se envuelve; el cursor queda después del cierre.
  if (seleccion) {
    return {
      valor: `${valor.slice(0, inicio)}${caracter}${seleccion}${cierre}${valor.slice(fin)}`,
      cursor: fin + 2,
    };
  }

  // Sin selección: par vacío, cursor en medio.
  return {
    valor: `${valor.slice(0, inicio)}${caracter}${cierre}${valor.slice(fin)}`,
    cursor: inicio + 1,
  };
}

/**
 * Cierre tecleado cuando ya está delante del cursor: se salta el carácter en vez de duplicarlo.
 * Devuelve `null` cuando de verdad hay que insertarlo (no está delante).
 */
export function alCerrar(
  valor: string,
  inicio: number,
  fin: number,
  caracter: string
): EdicionDeTexto | null {
  if (!CIERRES.has(caracter)) return null;
  if (inicio !== fin) return null;
  if (valor[inicio] !== caracter) return null;
  return { valor, cursor: inicio + 1 };
}

/**
 * ⌫ entre un par vacío borra los dos. Con selección o fuera de un par, `null` (borrado normal).
 */
export function alBorrar(valor: string, inicio: number, fin: number): EdicionDeTexto | null {
  if (inicio !== fin || inicio === 0) return null;
  const antes = valor[inicio - 1];
  const despues = valor[inicio];
  if (!antes || PARES[antes] !== despues) return null;
  return {
    valor: valor.slice(0, inicio - 1) + valor.slice(inicio + 1),
    cursor: inicio - 1,
  };
}
