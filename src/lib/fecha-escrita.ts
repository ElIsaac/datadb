/**
 * Fecha escrita a mano en el selector de fecha del grid (R93, pedido del usuario 2026-10-21:
 * «cuando es una fecha el calendario, no tengo que moverme para cambiarla»).
 *
 * POR QUÉ EXISTE: el `DatePicker` del grid sólo ofrecía el calendario. Para pasar de 2026 a 2019
 * había que pulsar la flecha del mes 84 veces, así que cambiar una fecha lejana era más lento que
 * reescribir la consulta. Con un campo de texto al lado del calendario se escribe la fecha y se
 * aplica con ⏎; el calendario sigue ahí para el caso normal (elegir un día cercano).
 *
 * REGLAS DE PARSEO (a propósito, pocas y explícitas):
 *  - Acepta `aaaa-mm-dd`, `aaaa/mm/dd`, `dd/mm/aaaa`, `dd-mm-aaaa` y `dd.mm.aaaa` (los separadores
 *    de México y España son `/` y `-`; el punto se acepta porque se cuela al teclear).
 *  - Dos dígitos de año NO se adivinan («26» podría ser 1926 o 2026): se rechazan. Fallar en voz
 *    alta es mejor que escribir una fecha equivocada en la base.
 *  - Rechaza fechas imposibles (`2026-02-31`) con una comprobación de ida y vuelta contra `Date`:
 *    `new Date(2026, 1, 31)` se convierte en el 3 de marzo y no vuelve igual.
 *  - Trabaja en **reloj de pared**: la fecha que se escribe es la que se guarda, sin zona horaria.
 *    Es la misma convención de `parseWallClock` en `editable-cell.tsx` y la razón del bug de un día
 *    que se corrigió en la fase 11.
 *
 * Devuelve la fecha normalizada (`aaaa-mm-dd`, que es lo que entiende el UPDATE) o `null` si no es
 * una fecha válida.
 */
export function fechaEscritaAValor(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio) return null;

  let anio: number;
  let mes: number;
  let dia: number;

  // aaaa-mm-dd / aaaa/mm/dd
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(limpio);
  // dd-mm-aaaa / dd/mm/aaaa / dd.mm.aaaa
  const europea = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(limpio);

  if (iso) {
    anio = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else if (europea) {
    dia = Number(europea[1]);
    mes = Number(europea[2]);
    anio = Number(europea[3]);
  } else {
    return null;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (anio < 1 || anio > 9999) return null;

  // Ida y vuelta: `Date` normaliza los desbordes (31 de febrero → 3 de marzo), así que si al
  // reconstruir no coinciden los tres campos, la fecha no existía.
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    return null;
  }

  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** `true` si el texto ya es una fecha completa y válida (para pintar el campo en rojo sin esperar). */
export function esFechaEscritaValida(texto: string): boolean {
  return fechaEscritaAValor(texto) !== null;
}
