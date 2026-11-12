/**
 * R96 — la lógica pura de la tool window «Consultas guardadas» (rediseño propuesto con Open Design y
 * aprobado por el usuario el 2026-10-21: `design/propuesta-consultas-guardadas.png`).
 *
 * Sin React, con tests (`consultas-guardadas.test.ts`). La vista (`components/saved-queries.tsx`)
 * solo pinta lo que sale de aquí:
 *
 *  - **A qué conexión pertenece una consulta.** Antes se ligaba por el NOMBRE de la conexión
 *    (`connectionId = session.name`): renombrar el perfil dejaba sus consultas huérfanas, y el panel
 *    filtraba en el servidor con el nombre de la PRIMERA sesión que veía (cambiar de consola a otra
 *    conexión no recargaba la lista). Ahora la consulta guarda además el `profileId`, que manda; el
 *    nombre queda como respaldo para las guardadas antes de este cambio.
 *  - **Buscar, ordenar y agrupar** («Esta conexión» = lista plana; «Todas» = agrupada por conexión,
 *    la de la consola primero).
 *  - **Fecha relativa** de la fila («hace 5 min», «ayer», «12 oct»).
 *  - **Resaltar** lo buscado en el nombre y en la línea de SQL donde aparece.
 *  - **Dónde se abre** una consulta (decisión del orquestador, provisional y reversible, porque el
 *    usuario no contestó esa pregunta: se abre en la consola actual solo si está vacía o ya es esa
 *    consulta; si no, en una consola nueva — nunca se pisa texto sin guardar, que es lo que hacía
 *    «Cargar en editor»).
 */
import type { SavedQuery } from "@/lib/types";

/** La conexión contra la que se mira «Esta conexión»: la de la consola con foco. */
export interface ConexionDeReferencia {
  profileId?: string;
  name: string;
}

export type AlcanceDeConsultas = "conexion" | "todas";
export type OrdenDeConsultas = "recientes" | "nombre";

/**
 * ¿Pertenece la consulta a esta conexión? El `profileId` manda; sin él (consultas guardadas antes
 * de R96) se compara el nombre de la conexión, que es lo único que guardaban.
 */
export function perteneceA(consulta: SavedQuery, conexion: ConexionDeReferencia | null): boolean {
  if (!conexion) return false;
  if (consulta.profileId && conexion.profileId) return consulta.profileId === conexion.profileId;
  return (consulta.connectionId ?? "") === conexion.name;
}

/** Texto normalizado para buscar: sin mayúsculas ni acentos («Depósitos» casa con «depositos»). */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** ¿Casa la consulta con lo buscado (nombre o SQL)? Vacío = todas. */
export function casaConBusqueda(consulta: SavedQuery, termino: string): boolean {
  const t = normalizar(termino.trim());
  if (!t) return true;
  return normalizar(consulta.name).includes(t) || normalizar(consulta.sql).includes(t);
}

/** Ordena sin mutar: recientes = última modificación primero; nombre = A–Z en español. */
export function ordenarConsultas(consultas: readonly SavedQuery[], orden: OrdenDeConsultas): SavedQuery[] {
  const copia = [...consultas];
  if (orden === "nombre") {
    copia.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  } else {
    copia.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return copia;
}

export interface GrupoDeConsultas {
  /** Clave estable del grupo (perfil, o nombre si la consulta no guardó perfil). */
  clave: string;
  /** Nombre que se pinta: el de la conexión. */
  nombre: string;
  /** Perfil del grupo, si se conoce (para el logo del motor y para abrir en él). */
  profileId?: string;
  consultas: SavedQuery[];
}

/**
 * Lo que enseña la lista: filtrada por alcance y búsqueda, ordenada, y agrupada por conexión con
 * «Todas» (con «Esta conexión» sale un único grupo). El grupo de la conexión de referencia va
 * primero; el resto, por nombre. `nombreDePerfil` traduce un `profileId` al nombre ACTUAL del
 * perfil (renombrar el perfil renombra el grupo).
 */
export function vistaDeConsultas(
  consultas: readonly SavedQuery[],
  opciones: {
    alcance: AlcanceDeConsultas;
    busqueda: string;
    orden: OrdenDeConsultas;
    conexion: ConexionDeReferencia | null;
    nombreDePerfil?: (profileId: string) => string | undefined;
  }
): GrupoDeConsultas[] {
  const { alcance, busqueda, orden, conexion, nombreDePerfil } = opciones;
  const visibles = ordenarConsultas(
    consultas.filter(
      (q) => (alcance === "todas" || perteneceA(q, conexion)) && casaConBusqueda(q, busqueda)
    ),
    orden
  );
  const grupos = new Map<string, GrupoDeConsultas>();
  for (const q of visibles) {
    const clave = q.profileId ? `perfil:${q.profileId}` : `nombre:${q.connectionId ?? ""}`;
    const nombre =
      (q.profileId && nombreDePerfil?.(q.profileId)) || q.connectionId || "Sin conexión";
    const grupo = grupos.get(clave) ?? { clave, nombre, profileId: q.profileId, consultas: [] };
    grupo.consultas.push(q);
    grupos.set(clave, grupo);
  }
  // Varias claves pueden ser la MISMA conexión (una consulta vieja guardada por nombre y otra nueva
  // por perfil): se juntan por el nombre que se pinta, que es lo que el usuario reconoce.
  const porNombre = new Map<string, GrupoDeConsultas>();
  for (const g of grupos.values()) {
    const previo = porNombre.get(g.nombre);
    if (previo) {
      previo.consultas = ordenarConsultas([...previo.consultas, ...g.consultas], orden);
      previo.profileId ??= g.profileId;
    } else {
      porNombre.set(g.nombre, { ...g });
    }
  }
  const lista = [...porNombre.values()];
  const esLaActual = (g: GrupoDeConsultas) =>
    conexion !== null && g.consultas.some((q) => perteneceA(q, conexion));
  lista.sort((a, b) => {
    const pa = esLaActual(a) ? 0 : 1;
    const pb = esLaActual(b) ? 0 : 1;
    return pa - pb || a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
  });
  return lista;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Fecha relativa de la fila: «ahora», «hace N min», «hace N h», «ayer», «12 oct» (este año) o
 * «12 oct 2025». Se calcula en la hora LOCAL del usuario (el «ayer» es de su calendario).
 */
export function fechaRelativa(iso: string | undefined, ahora: Date = new Date()): string {
  if (!iso) return "";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const segundos = Math.round((ahora.getTime() - fecha.getTime()) / 1000);
  if (segundos < 60) return "ahora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const inicioDeAyer = new Date(inicioDeHoy.getTime() - 24 * 3600 * 1000);
  if (fecha >= inicioDeHoy) return `hace ${Math.floor(minutos / 60)} h`;
  if (fecha >= inicioDeAyer) return "ayer";
  const corta = `${fecha.getDate()} ${MESES_CORTOS[fecha.getMonth()]}`;
  return fecha.getFullYear() === ahora.getFullYear() ? corta : `${corta} ${fecha.getFullYear()}`;
}

/** Fecha completa para la vista previa: «12 oct 2026, 18:25». */
export function fechaCompleta(iso: string | undefined): string {
  if (!iso) return "";
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return "";
  const hh = String(f.getHours()).padStart(2, "0");
  const mm = String(f.getMinutes()).padStart(2, "0");
  return `${f.getDate()} ${MESES_CORTOS[f.getMonth()]} ${f.getFullYear()}, ${hh}:${mm}`;
}

/**
 * Trozos de un texto con lo buscado marcado (para pintar `<mark>`). La comparación ignora
 * mayúsculas y acentos, pero los trozos conservan el texto original.
 */
export function trozosResaltados(texto: string, termino: string): Array<{ texto: string; coincide: boolean }> {
  const t = normalizar(termino.trim());
  if (!t) return [{ texto, coincide: false }];
  // `normalizar` puede cambiar la longitud (NFD separa acentos): se compara carácter a carácter
  // normalizando cada uno, así los índices son los del texto original.
  const base = [...texto].map((c) => normalizar(c));
  const trozos: Array<{ texto: string; coincide: boolean }> = [];
  const original = [...texto];
  let i = 0;
  let pendiente = "";
  while (i < original.length) {
    let j = i;
    let acumulado = "";
    while (j < original.length && acumulado.length < t.length) {
      acumulado += base[j];
      j++;
    }
    if (acumulado === t) {
      if (pendiente) trozos.push({ texto: pendiente, coincide: false });
      pendiente = "";
      trozos.push({ texto: original.slice(i, j).join(""), coincide: true });
      i = j;
    } else {
      pendiente += original[i];
      i++;
    }
  }
  if (pendiente) trozos.push({ texto: pendiente, coincide: false });
  return trozos;
}

/**
 * La línea del SQL donde está lo buscado, recortada (para la segunda línea de la fila). `null` si
 * no hay búsqueda o si la coincidencia está solo en el NOMBRE (ahí ya se ve).
 */
export function lineaCoincidente(consulta: SavedQuery, termino: string): string | null {
  const t = normalizar(termino.trim());
  if (!t || normalizar(consulta.name).includes(t)) return null;
  const linea = consulta.sql.split("\n").find((l) => normalizar(l).includes(t));
  return linea ? linea.trim() : null;
}

/**
 * ¿Dónde se abre la consulta? En la consola ACTUAL si está vacía (y su conexión no choca) o si ya
 * es esa misma consulta; si no, en una consola NUEVA. Así abrir nunca pisa texto del usuario.
 */
export function dondeAbrir(
  consola: { sql: string; activeSavedQueryId: string | null },
  consulta: SavedQuery,
  conexionDeLaConsola: ConexionDeReferencia | null
): "actual" | "nueva" {
  if (consola.activeSavedQueryId === consulta.id) return "actual";
  if (consola.sql.trim() !== "") return "nueva";
  // Vacía: se usa si no tiene conexión o si es la de la consulta (si no, se quedaría corriendo
  // el SQL contra otra base).
  if (!conexionDeLaConsola || perteneceA(consulta, conexionDeLaConsola)) return "actual";
  return "nueva";
}

/**
 * R96: liga al PERFIL las consultas guardadas antes de R96, que solo tenían el nombre de la
 * conexión (`connectionId`) y quedaban huérfanas al renombrar el perfil. Solo se liga cuando el
 * nombre corresponde a UN único perfil (dos perfiles con el mismo nombre = ambiguo, se deja como
 * está y el panel sigue reconociéndola por el nombre). No toca `updatedAt`: ligar no es editar, y
 * cambiarla desordenaría «Recientes». Devuelve la lista ya ligada (y la escribe si cambió algo).
 */
export function ligarAPerfiles(
  consultas: SavedQuery[],
  perfiles: ReadonlyArray<{ id: string; name: string }>
): { consultas: SavedQuery[]; cambiadas: number } {
  let cambiadas = 0;
  const ligadas = consultas.map((q) => {
    if (q.profileId || !q.connectionId) return q;
    const candidatos = perfiles.filter((p) => p.name === q.connectionId);
    if (candidatos.length !== 1) return q;
    cambiadas++;
    return { ...q, profileId: candidatos[0].id };
  });
  return { consultas: ligadas, cambiadas };
}
