/**
 * R100 (T1) — caché EN MEMORIA de la vista de documentos, por pestaña de colección de Mongo.
 *
 * EL PROBLEMA: `app-shell` monta sólo la pestaña activa (`MongoDocuments` con `key={tab.id}`), así
 * que al cambiar de colección el componente se DESMONTA y su estado con él. Al volver, la pestaña
 * nacía con el filtro vacío y sin resultado — y encima lanzaba otra consulta a la base. El usuario
 * lo reportó así: «cuando cambio entre pestañas de las colecciones me quita el resultado que ya
 * tenía en una consulta».
 *
 * LA DECISIÓN: un caché por id de pestaña que sobrevive a cambiar de pestaña DENTRO de la sesión de
 * la app. NO se persiste a disco: los resultados son datos de la sesión (morirían con el worker
 * igual que las sesiones) y guardarlos en disco los pondría viejos sin que el usuario lo sepa. Al
 * montar, `MongoDocuments` lee del caché y nace con lo que había; si ya hay resultado guardado, no
 * repite la consulta. Mientras vive, cada cambio de la vista se escribe al caché.
 *
 * LRU: se acota a `MAXIMO_DE_VISTAS` pestañas para que abrir 30 colecciones no acumule 30 páginas
 * de documentos en memoria. La política usa el orden del `Map` (recuerda el orden de inserción):
 * leer o escribir mueve la entrada al final («más recientemente usada») y, al pasarse del máximo,
 * se descarta el primero del Map — el más viejo, que es exactamente el menos usado últimamente.
 *
 * Este módulo es PURO (sin React, sin IPC), al estilo de `grid-widths.ts`: se prueba sin montar
 * la app (ver `mongo-vista.test.ts`).
 */
import type { MongoFindResult } from "@/shared/mongo-view";

/**
 * Lo que una pestaña de colección recuerda de sí misma. Los campos son los `useState` de
 * `MongoDocuments` — si allí nace un estado nuevo que deba sobrevivir al cambio de pestaña, se
 * añade aquí y se guarda en el efecto que escribe al caché.
 */
export interface VistaDeColeccion {
  /** Lo tecleado en la barra de consulta. */
  filtro: string;
  proyeccion: string;
  orden: string;
  /** Si el bloque de «Opciones» (proyección/orden) está desplegado. */
  opcionesAbiertas: boolean;
  /** El filtro que se está MOSTRANDO (separado de lo tecleado). */
  aplicado: { filtro: string; proyeccion: string; orden: string };
  pagina: number;
  porPagina: number;
  vista: "lista" | "json";
  /** La última página traída del worker, ya pintada. `null` = no había resultado. */
  resultado: MongoFindResult | null;
  /** Borradores de edición sin guardar, por clave de documento (fase 85). */
  borradores: Record<string, Record<string, unknown>>;
  /**
   * Errores POR documento (los de un guardado fallido). Se conservan porque, si no, al volver a la
   * pestaña el usuario pierde el motivo del fallo y no sabe qué quedó a medias.
   */
  erroresDoc: Record<string, string | null>;
}

/** Techo del caché: con más colecciones abiertas que esto, la menos usada se olvida. */
export const MAXIMO_DE_VISTAS = 12;

/**
 * Crea un caché LRU de vistas por id de pestaña. Cada instancia es independiente (los tests crean
 * las suyas con `maximo` pequeño); la app usa la singleton de abajo.
 */
export function crearCacheDeVistas(maximo: number = MAXIMO_DE_VISTAS) {
  const entradas = new Map<string, VistaDeColeccion>();
  return {
    /**
     * La vista de la pestaña, o `undefined` si no hay. Si existe se REINSERTA al final: leer es
     * «usar», y la salva de ser la expulsada la próxima vez que el caché se llene.
     */
    leer(pestanaId: string): VistaDeColeccion | undefined {
      const vista = entradas.get(pestanaId);
      if (vista === undefined) return undefined;
      entradas.delete(pestanaId);
      entradas.set(pestanaId, vista);
      return vista;
    },
    /** Guarda (o pisa) la vista de la pestaña, al final, y recorta si se pasó del máximo. */
    escribir(pestanaId: string, vista: VistaDeColeccion): void {
      entradas.delete(pestanaId);
      entradas.set(pestanaId, vista);
      if (entradas.size > maximo) {
        // La primera clave insertada del Map es la más vieja: fuera.
        const masVieja = entradas.keys().next().value;
        if (masVieja !== undefined) entradas.delete(masVieja);
      }
    },
    /** Olvida una pestaña (p. ej. si se cierra). Olvidar lo que no existe no rompe. */
    olvidar(pestanaId: string): void {
      entradas.delete(pestanaId);
    },
    /** Cuántas vistas viven ahora (para los tests y para razonar la memoria). */
    tamano(): number {
      return entradas.size;
    },
  };
}

export type CacheDeVistas = ReturnType<typeof crearCacheDeVistas>;

/**
 * La instancia que usa la app. Vive en el renderer, como las vistas que guarda: al cerrar la
 * ventana muere con ella, igual que el resto del estado de sesión.
 */
export const cacheDeVistasMongo = crearCacheDeVistas();
