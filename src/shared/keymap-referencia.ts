/**
 * ============================================================================
 * Fase 15 (R13) · Tarea T7 — la REFERENCIA de atajos, generada del registro
 * ============================================================================
 *
 * Decisión D4 del PLAN: Help ▸ «Atajos de teclado» es una lista GENERADA del MISMO registro que
 * aplica los atajos (`src/shared/keymap.ts`). Una referencia que no puede mentir: si un atajo
 * cambia, cambia la lista. Este archivo es la parte PURA —agrupar por contexto y filtrar— y el
 * diálogo (`src/components/shortcuts-dialog.tsx`) sólo la pinta; así el agrupado y el buscador
 * tienen tests de verdad y no se prueban a través del DOM.
 *
 * QUÉ NO ES: no es un segundo registro. No declara ni una tecla: todo sale de `REGISTRO` y de sus
 * conversores (`aTextoMac`), y no hay ninguna entrada escrita a mano aquí.
 *
 * LA NOTA DE D2 ([D])
 * -------------------
 * Las filas con procedencia `"D"` son las que `research/datagrip-ux.md` trae convertidas del keymap
 * de Windows y que NO se han verificado contra un DataGrip real. El PLAN exige que esa marca viaje
 * a la referencia «con una nota visible»: `NOTA_D2` es esa nota, se expone como constante para que
 * el diálogo la enseñe UNA vez (leyenda) y para que el test fije su texto. Las `"M"` están
 * verificadas contra la página oficial; las `"app"` son atajos propios de DataDB que DataGrip no
 * tiene (en el PLAN aparecen con «—»).
 */
import {
  REGISTRO,
  textosDe,
  type Contexto,
  type Procedencia,
} from "./keymap";

/** Una fila de la referencia: sólo texto, nada que calcular en el diálogo. */
export interface FilaReferencia {
  /** Id estable del registro (el `data-atajo-id` que usará la medición final, T8). */
  id: string;
  /** Nombre de la acción como en DataGrip. */
  nombre: string;
  /** El atajo principal en texto de macOS («⌘⌥L», «⇧⏎»). */
  atajo: string;
  /** Alias conservados (D1) en texto de macOS. Lista vacía si no tiene. */
  alias: string[];
  /** `[M]` / `[D]` / `[app]` — la marca de la investigación. */
  procedencia: Procedencia;
  /** La `#` de `research/datagrip-ux.md` §4, cuando la hay. */
  fila?: number;
  /** La nota del registro (choques resueltos, decisiones D1-D8). */
  nota?: string;
}

/** Un contexto del registro con sus filas, listo para pintar. */
export interface GrupoReferencia {
  contexto: Contexto;
  /** Título humano del grupo («Global», «Editor SQL», «Rejilla de datos», «Árbol de esquema»). */
  titulo: string;
  filas: FilaReferencia[];
}

/**
 * Orden de los grupos, el mismo de la tabla del PLAN (Global → Editor → Rejilla → Árbol). No se
 * deriva del registro a propósito: el registro está ordenado por bloques y una reordenación
 * accidental de sus filas no debe reordenar la referencia.
 */
export const ORDEN_CONTEXTOS: readonly Contexto[] = ["global", "editor", "rejilla", "arbol"];

/** Título visible de cada contexto. */
export const TITULOS_CONTEXTO: Record<Contexto, string> = {
  global: "Global",
  editor: "Editor SQL",
  rejilla: "Rejilla de datos",
  arbol: "Árbol de esquema",
};

/**
 * La nota de D2, tal cual la exige el PLAN («convertida desde el keymap de Windows, sin verificar
 * en un DataGrip real»). El diálogo la enseña como leyenda de las filas `[D]`.
 */
export const NOTA_D2 = "convertida desde el keymap de Windows, sin verificar en un DataGrip real";

/** Etiqueta visible de la procedencia: `[M]`, `[D]` o «—» (atajo propio de DataDB). */
export function etiquetaProcedencia(p: Procedencia): string {
  return p === "app" ? "—" : `[${p}]`;
}

/** Convierte una entrada del registro en fila de referencia (todo el texto ya resuelto). */
function aFila(entrada: (typeof REGISTRO)[number]): FilaReferencia {
  const [principal, ...alias] = textosDe(entrada);
  return {
    id: entrada.id,
    nombre: entrada.nombre,
    atajo: principal,
    alias,
    procedencia: entrada.procedencia,
    fila: entrada.fila,
    nota: entrada.nota,
  };
}

/**
 * La referencia completa: una fila por entrada del registro, agrupada por contexto en el orden de
 * `ORDEN_CONTEXTOS`. Nada escrito a mano más allá de los títulos.
 */
export function construirReferencia(): GrupoReferencia[] {
  return ORDEN_CONTEXTOS.map((contexto) => ({
    contexto,
    titulo: TITULOS_CONTEXTO[contexto],
    filas: REGISTRO.filter((e) => e.contexto === contexto).map(aFila),
  }));
}

/** Número total de atajos de la referencia (para el «N atajos» de la cabecera). */
export function totalDeFilas(grupos: GrupoReferencia[]): number {
  return grupos.reduce((acc, g) => acc + g.filas.length, 0);
}

/**
 * Normaliza para buscar: minúsculas, sin espacios alrededor y sin acentos (quien busca «atajo»
 * también encuentra «Árbol»). `NFD` separa el acento de la letra y el rango de diacríticos se borra.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtro del buscador: por NOMBRE de la acción, por la TECLA (principal o alias) y también por id
 * (el vocabulario del registro, p. ej. «nextTab» sirve para llegar a «Select Next Tab»). Vacío →
 * todo. Devuelve la misma forma que `construirReferencia`, sin grupos vacíos.
 */
export function filtrarReferencia(grupos: GrupoReferencia[], consulta: string): GrupoReferencia[] {
  const q = normalizar(consulta);
  if (!q) return grupos;
  return grupos
    .map((g) => ({
      ...g,
      filas: g.filas.filter((f) =>
        [f.nombre, f.id, f.atajo, ...f.alias].some((campo) => normalizar(campo).includes(q))
      ),
    }))
    .filter((g) => g.filas.length > 0);
}
