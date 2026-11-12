/**
 * La fecha PARTIDA del editor de celdas (R95, pedido del usuario 2026-10-21 con una captura de
 * DataGrip al lado): «el calendario de DataGrip no lo muestra todo, lo parte».
 *
 * DataGrip no abre un calendario de mes al editar una fecha: abre, bajo la celda, una tira de
 * campos sueltos — día ▾, mes ▾ (por nombre), año con flechas y, si hay hora, hora / minuto /
 * segundo con flechas — y se cambia SOLO la parte que hace falta. Este módulo es la mitad pura de
 * ese editor: descomponer el valor de la celda en partes, cambiar una parte sin romper la fecha y
 * volver a componer el texto que va al UPDATE. Sin React, con tests.
 *
 * Convenciones (las mismas de `fecha-escrita.ts` y `parseWallClock`):
 *  - **Reloj de pared.** `2026-10-21 03:19:00` se edita como 03:19 del 21 de octubre, sin pasar por
 *    zonas horarias (el bug del día de menos de la fase 11 venía de tratarla como instante).
 *  - **La fracción de segundo se conserva tal cual** (`.000000`, `.123`): el editor no la muestra,
 *    y tirarla al guardar cambiaría un valor que el usuario no tocó.
 *  - **Nunca una fecha imposible.** Al pasar del 31 de enero a febrero el día se acota al último
 *    del mes (28/29), igual que el selector de DataGrip; no se deja «31 de febrero» ni se desborda
 *    al 3 de marzo.
 */
import { fechaEscritaAValor } from "./fecha-escrita";

export interface PartesDeFecha {
  anio: number;
  /** 1–12. */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  /** Fracción de segundo tal como llegó, con el punto (`".000000"`), o `""`. */
  fraccion: string;
}

export type ParteDeFecha = "anio" | "mes" | "dia" | "hora" | "minuto" | "segundo";

/** Nombres de mes del desplegable, en el idioma de la app (la captura de DataGrip los da en español). */
export const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Días del mes (`mes` 1–12), con bisiestos. */
export function diasDelMes(anio: number, mes: number): number {
  // El día 0 del mes siguiente es el último de éste.
  return new Date(anio, mes, 0).getDate();
}

/** Tope y piso de cada parte. El año se acota a lo que entiende cualquier motor (1–9999). */
const RANGOS: Record<Exclude<ParteDeFecha, "dia">, [number, number]> = {
  anio: [1, 9999],
  mes: [1, 12],
  hora: [0, 23],
  minuto: [0, 59],
  segundo: [0, 59],
};

function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Las partes de un valor de celda en reloj de pared (`aaaa-mm-dd`, `aaaa-mm-dd hh:mm[:ss[.f]]`,
 * con `T` o espacio). `null` si la celda es NULL o no parece una fecha.
 */
export function partesDeValor(valor: unknown): PartesDeFecha | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?/.exec(texto);
  if (!m) return null;
  const partes: PartesDeFecha = {
    anio: Number(m[1]),
    mes: Number(m[2]),
    dia: Number(m[3]),
    hora: m[4] ? Number(m[4]) : 0,
    minuto: m[5] ? Number(m[5]) : 0,
    segundo: m[6] ? Number(m[6]) : 0,
    fraccion: m[7] ?? "",
  };
  if (partes.mes < 1 || partes.mes > 12) return null;
  if (partes.dia < 1 || partes.dia > diasDelMes(partes.anio, partes.mes)) return null;
  return partes;
}

/** Las partes de un `Date` en hora LOCAL (para columnas con zona: se edita en la hora del usuario). */
export function partesDeDate(fecha: Date): PartesDeFecha {
  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
    hora: fecha.getHours(),
    minuto: fecha.getMinutes(),
    segundo: fecha.getSeconds(),
    fraccion: "",
  };
}

/** Las partes de «ahora», para cuando la celda era NULL y el usuario empieza a elegir. */
export function partesDeAhora(): PartesDeFecha {
  const p = partesDeDate(new Date());
  return { ...p, segundo: 0 };
}

/**
 * Cambia UNA parte y devuelve partes válidas: la parte se acota a su rango y, si al cambiar mes o
 * año el día ya no existe (31 → febrero), el día baja al último del mes.
 */
export function conParte(partes: PartesDeFecha, parte: ParteDeFecha, valor: number): PartesDeFecha {
  if (!Number.isFinite(valor)) return partes;
  const siguiente = { ...partes };
  if (parte === "dia") {
    siguiente.dia = acotar(valor, 1, diasDelMes(partes.anio, partes.mes));
    return siguiente;
  }
  const [min, max] = RANGOS[parte];
  siguiente[parte] = acotar(valor, min, max);
  siguiente.dia = Math.min(siguiente.dia, diasDelMes(siguiente.anio, siguiente.mes));
  return siguiente;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm-dd`: lo que va al UPDATE de una columna `date`. */
export function aValorFecha(p: PartesDeFecha): string {
  return `${String(p.anio).padStart(4, "0")}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** `aaaa-mm-dd hh:mm:ss[.f]`: lo que va al UPDATE de una columna fecha-hora sin zona. */
export function aValorFechaHora(p: PartesDeFecha): string {
  return `${aValorFecha(p)} ${dos(p.hora)}:${dos(p.minuto)}:${dos(p.segundo)}${p.fraccion}`;
}

/** El instante ISO (UTC) de unas partes en hora local: columnas con zona horaria. */
export function aInstanteIso(p: PartesDeFecha): string {
  return new Date(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo).toISOString();
}

/**
 * Lo escrito en el campo de texto del editor → partes, o `null` si no es una fecha (y hora)
 * válida. La fecha acepta los formatos de R93 (`aaaa-mm-dd`, `dd/mm/aaaa`…); con `conHora`, puede
 * seguirle una hora `hh:mm[:ss[.f]]` separada por espacio o `T`. Sin hora escrita se conserva la
 * de `base` (escribir solo la fecha no pone la hora a medianoche).
 */
export function partesDeTexto(
  texto: string,
  conHora: boolean,
  base: PartesDeFecha | null
): PartesDeFecha | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const [fechaTexto, ...resto] = limpio.split(/[\sT]+/);
  const horaTexto = resto.join(" ");
  if (!conHora && horaTexto) return null;
  const fecha = fechaEscritaAValor(fechaTexto);
  if (!fecha) return null;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const partes: PartesDeFecha = {
    anio,
    mes,
    dia,
    hora: base?.hora ?? 0,
    minuto: base?.minuto ?? 0,
    segundo: base?.segundo ?? 0,
    fraccion: base?.fraccion ?? "",
  };
  if (!horaTexto) return partes;
  const h = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/.exec(horaTexto);
  if (!h) return null;
  const hora = Number(h[1]);
  const minuto = Number(h[2]);
  const segundo = h[3] ? Number(h[3]) : 0;
  if (hora > 23 || minuto > 59 || segundo > 59) return null;
  return { ...partes, hora, minuto, segundo, fraccion: h[4] ?? "" };
}
