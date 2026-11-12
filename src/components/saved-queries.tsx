import * as React from "react";
import { IjIcon } from "@/components/ij-icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppState, useAppDispatch, useActiveConsole } from "@/hooks/use-app-state";
import { cn } from "@/lib/utils";
import {
  listProfiles,
  listSavedQueries,
  saveSavedQuery as apiSaveSavedQuery,
  updateSavedQuery as apiUpdateSavedQuery,
  deleteSavedQuery as apiDeleteSavedQuery,
} from "@/lib/api";
import type { ConnectionProfile, ConsoleBinding, SavedQuery } from "@/lib/types";
import { OwnEditor } from "@/components/own-editor/own-editor";
import { highlightLines, type Dialecto } from "@/components/own-editor/highlight";
import { IconoMotor } from "@/components/icono-motor";
import { bindingFromProfile, bindingFromSession, connectionOf } from "@/lib/console-binding";
import {
  dondeAbrir,
  fechaCompleta,
  fechaRelativa,
  lineaCoincidente,
  perteneceA,
  trozosResaltados,
  vistaDeConsultas,
  type AlcanceDeConsultas,
  type ConexionDeReferencia,
  type OrdenDeConsultas,
} from "@/lib/consultas-guardadas";

/*
  R96 — la tool window «Consultas guardadas», rediseñada.

  La propuesta salió de Open Design (proyecto de DataDB; `design/propuesta-consultas-guardadas.png`
  y su HTML interactivo al lado) y el usuario la aprobó el 2026-10-21 («me gusta como se ve»). Lo
  que cambia frente al panel de tarjetas de antes:

  - Lista COMPACTA tipo árbol de DataGrip (filas de 26 px), agrupada por conexión con «Todas» y
    plana con «Esta conexión». Cada fila: nombre, fecha relativa, barra de acento si es la que está
    cargada en la consola y punto ámbar si esa consola tiene cambios sin guardar.
  - Buscador que resalta lo encontrado en el nombre y, si está en el SQL, enseña la línea.
  - Vista previa abajo (divisor arrastrable) con el SQL coloreado y numerado, metadatos y acciones
    visibles: Abrir en la consola, Ejecutar, Consola nueva, Editar y Eliminar.
  - Eliminar se confirma EN LA FILA (no un diálogo) y el aviso trae «Deshacer».
  - Teclado: ↑/↓ moverse, ⏎ abrir, ⌘⏎ ejecutar, F2 renombrar, ⌫ eliminar.

  Lo que la maqueta traía y NO se construyó (anotado en R96): el botón de «nueva carpeta» — las
  consultas no tienen carpetas en el modelo.

  Arreglos de paso (fallos del panel viejo): la lista se cargaba UNA vez con el nombre de la primera
  conexión y no seguía a la consola con foco; las consultas se ligaban por el nombre de la conexión
  (renombrar el perfil las perdía); «Cargar en editor» pisaba el SQL de la consola sin avisar; y
  «Eliminar» borraba sin confirmar.
*/

/* ─── Diálogo «Guardar / Editar consulta» ─────────────────────────────────────── */

interface SaveFormProps {
  initialName?: string;
  initialSql?: string;
  queryId?: string;
  connectionId?: string;
  profileId?: string;
  database?: string;
  onSaved: (saved: SavedQuery) => void;
  onClose: () => void;
}

function SaveQueryForm({
  initialName,
  initialSql,
  connectionId,
  profileId,
  database,
  queryId,
  onSaved,
  onClose,
}: SaveFormProps) {
  const [name, setName] = React.useState(initialName ?? "");
  const [sql, setSql] = React.useState(initialSql ?? "");
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sql.trim()) return;
    setSaving(true);
    try {
      let saved: SavedQuery;
      if (queryId) {
        saved = await apiUpdateSavedQuery(queryId, { name: name.trim(), sql: sql.trim() });
        toast.success("Consulta actualizada");
      } else {
        // R96: además del nombre de la conexión se guarda el PERFIL (manda al filtrar: renombrar la
        // conexión ya no deja la consulta huérfana) y la base en la que estaba la consola.
        saved = await apiSaveSavedQuery({
          name: name.trim(),
          sql: sql.trim(),
          connectionId: connectionId ?? undefined,
          profileId: profileId ?? undefined,
          database: database ?? undefined,
        });
        toast.success("Consulta guardada");
      }
      onClose();
      onSaved(saved);
    } catch (err) {
      console.error("[consultas guardadas] no se pudo guardar", err);
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
        <DialogTitle>{queryId ? "Editar consulta" : "Guardar consulta"}</DialogTitle>
        <DialogDescription>Dale un nombre descriptivo para encontrarla después.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <div className="grid gap-1.5">
          <label htmlFor="saved-query-name" className="text-xs font-medium text-muted-foreground">
            Nombre
          </label>
          <Input
            id="saved-query-name"
            placeholder="Ej: Depósitos sin conciliar del día…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Consulta SQL</label>
          <div className="overflow-hidden rounded-lg border border-border/60 bg-gdb-editor">
            {/* El editor de la consola, también en «Guardar consulta»: un solo editor en toda la app. */}
            <OwnEditor value={sql} onChange={setSql} minHeight="320px" className="h-full min-h-0 text-sm font-jetbrains" />
          </div>
        </div>
      </div>
      <DialogFooter className="mx-0 mb-0 shrink-0 border-t border-border/60 px-6 py-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!name.trim() || !sql.trim() || saving}>
          {queryId ? "Actualizar" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface SaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initialSql?: string;
  queryId?: string;
  connectionId?: string;
  /** R96: perfil y base de la consola, para ligar la consulta nueva al perfil (no solo al nombre). */
  profileId?: string;
  database?: string;
  onSaved: (saved: SavedQuery) => void;
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  initialName,
  initialSql,
  queryId,
  connectionId,
  profileId,
  database,
  onSaved,
}: SaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-[min(96vw,64rem)] flex-col overflow-hidden p-0 sm:max-w-[min(96vw,64rem)]">
        <SaveQueryForm
          key={queryId ?? "new"}
          initialName={initialName}
          initialSql={initialSql}
          queryId={queryId}
          connectionId={connectionId}
          profileId={profileId}
          database={database}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ─── Preferencias de la vista ─────────────────────────────────────────────────── */

/**
 * Alcance, orden y alto de la vista previa. Son preferencias de VISTA (como el layout del dock), no
 * datos de un perfil: van en `localStorage`, con versión en la clave.
 */
const CLAVE_PREFERENCIAS = "datadb-consultas-guardadas-v1";
interface Preferencias {
  alcance: AlcanceDeConsultas;
  orden: OrdenDeConsultas;
  /** Fracción del alto del panel que ocupa la vista previa cuando va DEBAJO (0.2–0.75). */
  altoVistaPrevia: number;
  /** Fracción del ancho que ocupa la vista previa cuando va AL LADO (0.25–0.75). */
  anchoVistaPrevia: number;
}
const PREFERENCIAS_DE_FABRICA: Preferencias = {
  alcance: "conexion",
  orden: "recientes",
  altoVistaPrevia: 0.45,
  anchoVistaPrevia: 0.55,
};
const acotar = (v: unknown, min: number, max: number, defecto: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defecto;

function leerPreferencias(): Preferencias {
  try {
    const crudo = localStorage.getItem(CLAVE_PREFERENCIAS);
    if (!crudo) return PREFERENCIAS_DE_FABRICA;
    const p = JSON.parse(crudo) as Partial<Preferencias>;
    return {
      alcance: p.alcance === "todas" ? "todas" : "conexion",
      orden: p.orden === "nombre" ? "nombre" : "recientes",
      altoVistaPrevia: acotar(p.altoVistaPrevia, 0.2, 0.75, PREFERENCIAS_DE_FABRICA.altoVistaPrevia),
      anchoVistaPrevia: acotar(p.anchoVistaPrevia, 0.25, 0.75, PREFERENCIAS_DE_FABRICA.anchoVistaPrevia),
    };
  } catch (err) {
    console.error("[consultas guardadas] preferencias ilegibles; se usan las de fábrica", err);
    return PREFERENCIAS_DE_FABRICA;
  }
}

function persistirPreferencias(p: Preferencias): void {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(p));
  } catch (err) {
    console.error("[consultas guardadas] no se pudieron guardar las preferencias", err);
  }
}

/* ─── Piezas pequeñas ──────────────────────────────────────────────────────────── */

/** Texto con lo buscado marcado (mismo tinte ámbar que la propuesta). */
function Resaltado({ texto, termino }: { texto: string; termino: string }) {
  return (
    <>
      {trozosResaltados(texto, termino).map((t, i) =>
        t.coincide ? (
          <mark key={i} className="rounded-[2px] bg-gdb-warn/30 px-px text-gdb-fgstrong">
            {t.texto}
          </mark>
        ) : (
          <React.Fragment key={i}>{t.texto}</React.Fragment>
        )
      )}
    </>
  );
}

/** El SQL de la vista previa: coloreado con el lexer del editor y con números de línea. */
function SqlNumerado({ sql, dialecto, ajustar }: { sql: string; dialecto: Dialecto; ajustar: boolean }) {
  const lineas = React.useMemo(() => sql.split("\n"), [sql]);
  const tokens = React.useMemo(() => highlightLines(lineas, dialecto), [lineas, dialecto]);
  return (
    <pre
      className={cn(
        "m-0 min-h-0 overflow-auto rounded border border-gdb-sep bg-gdb-editor py-1.5 font-jetbrains text-[11px] leading-[17px] text-gdb-fgeditor",
        // Al lado (panel ancho) rellena su columna; debajo (barra lateral) mide lo que el SQL y los
        // botones quedan pegados a él, sin un hueco negro debajo de una consulta corta.
        ajustar ? "flex-initial" : "flex-1"
      )}
      data-testid="consulta-vista-previa-sql"
    >
      <code>
        {lineas.map((linea, i) => {
          const tramos: React.ReactNode[] = [];
          let cursor = 0;
          tokens[i].forEach((t, j) => {
            if (t.from > cursor) tramos.push(linea.slice(cursor, t.from));
            tramos.push(
              <span key={j} className={t.cls}>
                {linea.slice(t.from, t.to)}
              </span>
            );
            cursor = t.to;
          });
          if (cursor < linea.length) tramos.push(linea.slice(cursor));
          return (
            <div key={i} className="flex">
              <span className="w-7 shrink-0 pr-2 text-right text-gdb-lineno select-none">{i + 1}</span>
              {/* En la barra lateral (estrecha) las líneas largas se PARTEN: cortadas no se leen y una
                  barra horizontal en una vista previa de 300 px es peor. Al lado, sin partir. */}
              <span className={cn("min-w-0 pr-2", ajustar ? "break-words whitespace-pre-wrap" : "whitespace-pre")}>
                {tramos.length ? tramos : linea || " "}
              </span>
            </div>
          );
        })}
      </code>
    </pre>
  );
}

const dialectoDeMotor = (tipo?: string): Dialecto =>
  tipo === "mysql" ? "mysql" : tipo === "postgres" ? "postgres" : "standard";

/** Botón de icono de la barra/fila: 22 px, con hover real y `title` (la etiqueta va en el tooltip). */
function BotonIcono({
  icono,
  titulo,
  onClick,
  peligro,
  testid,
}: {
  icono: React.ComponentProps<typeof IjIcon>["name"];
  titulo: string;
  onClick: (e: React.MouseEvent) => void;
  peligro?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      data-testid={testid}
      onClick={onClick}
      className={cn(
        "grid size-[22px] shrink-0 place-items-center rounded text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg focus-visible:outline-1 focus-visible:outline-gdb-focus",
        peligro && "hover:bg-gdb-dangerbg"
      )}
    >
      <IjIcon name={icono} />
    </button>
  );
}

/* ─── La tool window ───────────────────────────────────────────────────────────── */

export function SavedQueriesPanel() {
  const state = useAppState();
  const console_ = useActiveConsole();
  const dispatch = useAppDispatch();

  const [preferencias, setPreferencias] = React.useState<Preferencias>(leerPreferencias);
  const cambiarPreferencias = (cambio: Partial<Preferencias>) => {
    const siguientes = { ...preferencias, ...cambio };
    setPreferencias(siguientes);
    persistirPreferencias(siguientes);
  };
  const { alcance, orden, altoVistaPrevia, anchoVistaPrevia } = preferencias;

  const [busqueda, setBusqueda] = React.useState("");
  const [seleccionId, setSeleccionId] = React.useState<string | null>(console_.activeSavedQueryId);
  const [renombrandoId, setRenombrandoId] = React.useState<string | null>(null);
  const [borrandoId, setBorrandoId] = React.useState<string | null>(null);
  const [plegados, setPlegados] = React.useState<ReadonlySet<string>>(new Set());
  const [perfiles, setPerfiles] = React.useState<ConnectionProfile[]>([]);
  const [dialogo, setDialogo] = React.useState<{ abierto: boolean; editando: SavedQuery | null }>({
    abierto: false,
    editando: null,
  });

  const listaRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const cuerpoRef = React.useRef<HTMLDivElement>(null);
  const busquedaRef = React.useRef<HTMLInputElement>(null);

  /*
    La propuesta se dibujó para una columna (lista arriba, vista previa abajo), pero «Guardadas»
    vive por defecto en el dock INFERIOR (fase 70: el izquierdo es del explorador), que es ancho y
    bajo (~1080×390): apilar ahí deja tres filas de lista. Así que la vista previa va AL LADO cuando
    el panel es ancho y DEBAJO cuando es alto (si el usuario lo mueve a un dock lateral). Se mide con
    un ResizeObserver: el dock se redimensiona sin re-renderizar este componente.
  */
  const [alLado, setAlLado] = React.useState(false);
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const medir = () => {
      const { width, height } = panel.getBoundingClientRect();
      setAlLado(width >= 600 && width > height * 1.4);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(panel);
    return () => observador.disconnect();
  }, []);

  // La conexión de la consola con foco (viva o dormida, R91): contra ella se mide «Esta conexión».
  const conexionDeLaConsola = connectionOf(console_);
  const conexionProfileId = conexionDeLaConsola?.profileId;
  const conexionNombre = conexionDeLaConsola?.name;
  const conexion = React.useMemo<ConexionDeReferencia | null>(
    () => (conexionNombre !== undefined ? { profileId: conexionProfileId, name: conexionNombre } : null),
    [conexionProfileId, conexionNombre]
  );

  // Carga: TODAS las consultas (el filtro por conexión es de la vista, así sigue a la consola con
  // foco sin volver a pedir nada) y los perfiles (logo del motor del grupo y consola nueva atada).
  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [consultas, lista] = await Promise.all([listSavedQueries(), listProfiles()]);
        if (!vivo) return;
        dispatch({ type: "SET_SAVED_QUERIES", payload: consultas });
        setPerfiles(lista);
      } catch (err) {
        console.error("[consultas guardadas] no se pudieron cargar", err);
        toast.error(`No se pudieron cargar las consultas guardadas: ${String(err)}`);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [dispatch]);

  const perfilPorId = React.useCallback((id?: string) => perfiles.find((p) => p.id === id), [perfiles]);
  /** El perfil de una consulta: por id; si es de antes de R96, por el nombre de la conexión. */
  const perfilDe = React.useCallback(
    (q: SavedQuery) => perfilPorId(q.profileId) ?? perfiles.find((p) => p.name === q.connectionId),
    [perfilPorId, perfiles]
  );

  const grupos = React.useMemo(
    () =>
      vistaDeConsultas(state.savedQueries, {
        alcance,
        busqueda,
        orden,
        conexion,
        nombreDePerfil: (id) => perfilPorId(id)?.name,
      }),
    [state.savedQueries, alcance, busqueda, orden, conexion, perfilPorId]
  );
  /** Las filas en el orden en que se ven (para ↑/↓): las de los grupos plegados no cuentan. */
  const filasVisibles = React.useMemo(
    () => grupos.flatMap((g) => (alcance === "todas" && plegados.has(g.clave) ? [] : g.consultas)),
    [grupos, plegados, alcance]
  );
  const totalEnAlcance = React.useMemo(
    () => state.savedQueries.filter((q) => alcance === "todas" || perteneceA(q, conexion)).length,
    [state.savedQueries, alcance, conexion]
  );

  const seleccionada = state.savedQueries.find((q) => q.id === seleccionId) ?? null;
  const consolaSucia = console_.activeSavedQueryId !== null && console_.sql !== console_.savedQuerySnapshot;

  /* ── Acciones ── */

  /** La conexión DORMIDA con la que nace una consola nueva para esta consulta (R91). */
  function bindingPara(q: SavedQuery): ConsoleBinding | null {
    const perfil = perfilDe(q);
    if (perfil) return { ...bindingFromProfile(perfil), database: q.database ?? (perfil.database || undefined) };
    // Sin perfil conocido: la conexión de la consola actual, si la consulta es de ella.
    if (perteneceA(q, conexion)) {
      return console_.session ? bindingFromSession(console_.session) : console_.binding;
    }
    return null;
  }

  function abrir(q: SavedQuery, opciones: { ejecutar?: boolean; nueva?: boolean } = {}) {
    // Como DataGrip con un archivo ya abierto: si OTRA consola ya tiene esta consulta, se enfoca su
    // pestaña (con lo que el usuario haya editado) en vez de abrir una segunda copia. «Consola nueva»
    // pide explícitamente otra.
    const yaAbierta = opciones.nueva
      ? undefined
      : state.consoles.find((c) => c.id !== console_.id && c.activeSavedQueryId === q.id);
    if (yaAbierta) {
      dispatch({ type: "SET_ACTIVE_CONSOLE", payload: yaAbierta.id });
      setSeleccionId(q.id);
      if (opciones.ejecutar) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("gestordb:execute-all")))
        );
      }
      return;
    }
    const destino = opciones.nueva ? "nueva" : dondeAbrir(console_, q, conexion);
    if (destino === "nueva") {
      const id = crypto.randomUUID();
      dispatch({ type: "NEW_CONSOLE", payload: { id, name: q.name } });
      const binding = bindingPara(q);
      if (binding) dispatch({ type: "SET_BINDING", payload: { consoleId: id, binding } });
      else toast.warning(`No encontré la conexión «${q.connectionId ?? "?"}»: elige una en la consola nueva`);
    }
    // Si la consola YA es esta consulta no se recarga el SQL: pisaría lo que el usuario editó.
    if (destino === "nueva" || console_.activeSavedQueryId !== q.id) {
      dispatch({ type: "SET_SQL", payload: q.sql });
      dispatch({ type: "SET_ACTIVE_SAVED_QUERY", payload: { id: q.id, sql: q.sql, name: q.name } });
    }
    dispatch({ type: "SET_ACTIVE_TAB", payload: "sql" });
    setSeleccionId(q.id);
    if (opciones.ejecutar) {
      // El editor de la consola (nueva o no) atiende «gestordb:execute-all» con SU texto; se espera
      // a que React monte/actualice la consola antes de emitirlo (dos cuadros: commit + efectos).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("gestordb:execute-all")))
      );
    }
  }

  async function renombrar(q: SavedQuery, nombre: string) {
    setRenombrandoId(null);
    const limpio = nombre.trim();
    if (!limpio || limpio === q.name) return;
    try {
      const actualizada = await apiUpdateSavedQuery(q.id, { name: limpio });
      dispatch({ type: "UPSERT_SAVED_QUERY", payload: actualizada });
      // Como en DataGrip al renombrar el archivo: las consolas que tienen abierta esta consulta
      // cambian el nombre de su pestaña (solo si seguían llamándose como la consulta: un nombre
      // que el usuario le puso a mano a la pestaña no se pisa).
      for (const c of state.consoles) {
        if (c.activeSavedQueryId === q.id && c.name === q.name) {
          dispatch({ type: "RENAME_CONSOLE", payload: { id: c.id, name: limpio } });
        }
      }
    } catch (err) {
      console.error("[consultas guardadas] no se pudo renombrar", err);
      toast.error(String(err));
    }
    listaRef.current?.focus();
  }

  async function eliminar(q: SavedQuery) {
    setBorrandoId(null);
    try {
      await apiDeleteSavedQuery(q.id);
      dispatch({ type: "SET_SAVED_QUERIES", payload: state.savedQueries.filter((x) => x.id !== q.id) });
      if (console_.activeSavedQueryId === q.id) {
        dispatch({ type: "SET_ACTIVE_SAVED_QUERY", payload: { id: null, sql: "" } });
      }
      if (seleccionId === q.id) setSeleccionId(null);
      toast("Consulta eliminada", {
        description: q.name,
        // 8 s (el doble del de fábrica): deshacer un borrado necesita tiempo para reaccionar.
        duration: 8000,
        action: {
          label: "Deshacer",
          onClick: () => {
            // Se recrea con los mismos datos (el id es nuevo: el almacén no reutiliza ids).
            void apiSaveSavedQuery({
              name: q.name,
              sql: q.sql,
              connectionId: q.connectionId,
              profileId: q.profileId,
              database: q.database,
            })
              .then((recuperada) => dispatch({ type: "UPSERT_SAVED_QUERY", payload: recuperada }))
              .catch((err) => {
                console.error("[consultas guardadas] no se pudo deshacer el borrado", err);
                toast.error(String(err));
              });
          },
        },
      });
    } catch (err) {
      console.error("[consultas guardadas] no se pudo eliminar", err);
      toast.error(String(err));
    }
    listaRef.current?.focus();
  }

  function guardarActual() {
    setDialogo({ abierto: true, editando: null });
  }

  /* ── Teclado de la lista ── */

  function mover(delta: 1 | -1) {
    if (filasVisibles.length === 0) return;
    const i = filasVisibles.findIndex((q) => q.id === seleccionId);
    const siguiente =
      i === -1 ? (delta === 1 ? 0 : filasVisibles.length - 1) : Math.min(filasVisibles.length - 1, Math.max(0, i + delta));
    const destino = filasVisibles[siguiente];
    setSeleccionId(destino.id);
    listaRef.current?.querySelector(`[data-consulta="${destino.id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function alPulsarEnLista(e: React.KeyboardEvent) {
    if (renombrandoId || borrandoId) return; // el campo de renombrar y la confirmación tienen su teclado
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      mover(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (!seleccionada) return;
    if (e.key === "Enter") {
      // ⌘⏎ ejecuta; se consume aquí para que no llegue al «Ejecutar» de la consola por otra vía.
      e.preventDefault();
      e.stopPropagation();
      abrir(seleccionada, { ejecutar: e.metaKey || e.ctrlKey });
    } else if (e.key === "F2") {
      e.preventDefault();
      setRenombrandoId(seleccionada.id);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setBorrandoId(seleccionada.id);
    }
  }

  /* ── Divisor de la vista previa ── */

  function arrastrarDivisor(e: React.PointerEvent) {
    e.preventDefault();
    const cuerpo = cuerpoRef.current;
    if (!cuerpo) return;
    const caja = cuerpo.getBoundingClientRect();
    let ultima = preferencias;
    const alMover = (ev: PointerEvent) => {
      ultima = alLado
        ? { ...ultima, anchoVistaPrevia: acotar((caja.right - ev.clientX) / caja.width, 0.25, 0.75, 0.55) }
        : { ...ultima, altoVistaPrevia: acotar((caja.bottom - ev.clientY) / caja.height, 0.2, 0.75, 0.45) };
      setPreferencias(ultima);
    };
    const alSoltar = () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      // Se persiste al soltar, no en cada píxel del arrastre.
      persistirPreferencias(ultima);
    };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
  }

  /* ── Render ── */

  const perfilSeleccionada = seleccionada ? perfilDe(seleccionada) : undefined;

  return (
    <div ref={panelRef} data-testid="saved-queries-panel" className="flex h-full w-full flex-col bg-gdb-chrome text-gdb-fg">
      {/* Barra: alcance, contador y acciones. El título ya lo pone la pestaña del dock. */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-gdb-sep px-2">
        <div className="flex h-[22px] overflow-hidden rounded border border-gdb-border text-[10.5px]" role="group" aria-label="Alcance">
          {(
            [
              ["conexion", "Esta conexión"],
              ["todas", "Todas"],
            ] as const
          ).map(([valor, rotulo], i) => (
            <button
              key={valor}
              type="button"
              aria-pressed={alcance === valor}
              data-testid={`consultas-alcance-${valor}`}
              onClick={() => cambiarPreferencias({ alcance: valor })}
              className={cn(
                "px-2 font-medium whitespace-nowrap text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg",
                i > 0 && "border-l border-gdb-border",
                alcance === valor && "bg-gdb-hover text-gdb-fgstrong"
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <span
          className="font-jetbrains text-[10.5px] text-gdb-fgdim tabular-nums"
          data-testid="consultas-contador"
          title="Consultas en este alcance"
        >
          {totalEnAlcance}
        </span>
        <div className="ml-auto flex items-center gap-px">
          <BotonIcono icono="add" titulo="Guardar consulta actual (⌘S desde la consola)" onClick={guardarActual} testid="consultas-guardar-actual" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  title={orden === "recientes" ? "Orden: recientes" : "Orden: nombre A–Z"}
                  aria-label="Orden"
                  data-testid="consultas-orden"
                  className="grid size-[22px] place-items-center rounded text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
                >
                  <IjIcon name="sortBy" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                {(
                  [
                    ["recientes", "Recientes"],
                    ["nombre", "Nombre A–Z"],
                  ] as const
                ).map(([valor, rotulo]) => (
                  <DropdownMenuItem key={valor} onClick={() => cambiarPreferencias({ orden: valor })} className="gap-2">
                    <span className="flex-1">{rotulo}</span>
                    {orden === valor && <span className="text-[10px] text-muted-foreground">actual</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Buscador */}
      <div className="shrink-0 px-2 py-1.5">
        <div className="relative">
          <IjIcon name="search" className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2" />
          <input
            ref={busquedaRef}
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listaRef.current?.focus();
                if (!seleccionId && filasVisibles[0]) setSeleccionId(filasVisibles[0].id);
              } else if (e.key === "Escape" && busqueda) {
                e.preventDefault();
                setBusqueda("");
              } else if (e.key === "Enter" && filasVisibles[0]) {
                e.preventDefault();
                abrir(seleccionada && filasVisibles.includes(seleccionada) ? seleccionada : filasVisibles[0]);
              }
            }}
            placeholder="Buscar por nombre o SQL…"
            aria-label="Buscar consultas guardadas"
            data-testid="consultas-buscar"
            className="h-[26px] w-full rounded-md border border-gdb-sep bg-gdb-editor pr-6 pl-7 text-[11.5px] text-gdb-fg outline-none placeholder:text-gdb-muted hover:border-gdb-border focus-visible:border-gdb-focus"
          />
          {busqueda && (
            <button
              type="button"
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
              onClick={() => {
                setBusqueda("");
                busquedaRef.current?.focus();
              }}
              className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded text-gdb-fgdim hover:bg-gdb-hover"
            >
              <IjIcon name="close" />
            </button>
          )}
        </div>
      </div>

      {/* Cuerpo: lista + vista previa, en columna o lado a lado según la forma del panel. */}
      <div ref={cuerpoRef} className={cn("flex min-h-0 flex-1", alLado ? "flex-row" : "flex-col")}>
      {/* Lista */}
      <div
        ref={listaRef}
        role="listbox"
        aria-label="Consultas guardadas"
        tabIndex={0}
        onKeyDown={alPulsarEnLista}
        data-testid="consultas-lista"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-2 outline-none"
      >
        {grupos.length === 0 ? (
          busqueda ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="consultas-sin-resultados">
              <p className="text-xs text-gdb-fg">Sin resultados para «{busqueda}»</p>
              <p className="text-[11px] text-gdb-fgdim">Ningún nombre ni SQL coincide.</p>
              <Button size="xs" variant="outline" onClick={() => setBusqueda("")}>
                Limpiar búsqueda
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="consultas-vacio">
              <IjIcon name="bookmark" size={32} className="opacity-30" />
              <p className="text-xs text-gdb-fg">
                {alcance === "conexion" && conexionNombre
                  ? `Aún no hay consultas guardadas en ${conexionNombre}`
                  : "Aún no hay consultas guardadas"}
              </p>
              <Button size="xs" onClick={guardarActual}>
                Guardar consulta actual
              </Button>
              <span className="text-[11px] text-gdb-fgdim">o ⌘S desde la consola</span>
            </div>
          )
        ) : (
          grupos.map((grupo, indiceGrupo) => {
            const plegado = alcance === "todas" && plegados.has(grupo.clave);
            const perfilDelGrupo = perfilPorId(grupo.profileId) ?? perfiles.find((p) => p.name === grupo.nombre);
            return (
              <div key={grupo.clave} className={cn(indiceGrupo > 0 && "mt-0.5 border-t border-gdb-sep pt-0.5")}>
                {alcance === "todas" && (
                  <button
                    type="button"
                    onClick={() =>
                      setPlegados((previo) => {
                        const siguiente = new Set(previo);
                        if (siguiente.has(grupo.clave)) siguiente.delete(grupo.clave);
                        else siguiente.add(grupo.clave);
                        return siguiente;
                      })
                    }
                    data-testid="consultas-grupo"
                    className="flex h-[26px] w-full items-center gap-1.5 pr-2 pl-1.5 text-left hover:bg-gdb-hover"
                  >
                    <IjIcon name={plegado ? "chevronRight" : "chevronDown"} />
                    <IconoMotor tipo={perfilDelGrupo?.type} />
                    <span className="truncate text-[11.5px] font-semibold">{grupo.nombre}</span>
                    <span className="ml-auto font-jetbrains text-[10px] text-gdb-fgdim tabular-nums">{grupo.consultas.length}</span>
                  </button>
                )}
                {!plegado &&
                  grupo.consultas.map((q) => (
                    <FilaDeConsulta
                      key={q.id}
                      consulta={q}
                      sangria={alcance === "todas"}
                      busqueda={busqueda}
                      seleccionada={seleccionId === q.id}
                      activa={console_.activeSavedQueryId === q.id}
                      sucia={console_.activeSavedQueryId === q.id && consolaSucia}
                      renombrando={renombrandoId === q.id}
                      borrando={borrandoId === q.id}
                      onSeleccionar={() => {
                        setSeleccionId(q.id);
                        listaRef.current?.focus();
                      }}
                      onAbrir={(opciones) => abrir(q, opciones)}
                      onRenombrar={() => setRenombrandoId(q.id)}
                      onConfirmarRenombre={(nombre) => void renombrar(q, nombre)}
                      onCancelarRenombre={() => {
                        setRenombrandoId(null);
                        listaRef.current?.focus();
                      }}
                      onEditar={() => setDialogo({ abierto: true, editando: q })}
                      onPedirBorrado={() => setBorrandoId(q.id)}
                      onConfirmarBorrado={() => void eliminar(q)}
                      onCancelarBorrado={() => {
                        setBorrandoId(null);
                        listaRef.current?.focus();
                      }}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {/* Vista previa de la seleccionada, con divisor arrastrable */}
      {seleccionada && (
        <>
          <div
            role="separator"
            aria-orientation={alLado ? "vertical" : "horizontal"}
            aria-label="Redimensionar la vista previa"
            onPointerDown={arrastrarDivisor}
            data-testid="consulta-divisor"
            className={cn(
              "group relative shrink-0 border-gdb-border",
              alLado ? "w-[6px] cursor-col-resize border-l" : "h-[6px] cursor-row-resize border-t"
            )}
          >
            <span
              className={cn(
                "absolute rounded-full bg-gdb-border group-hover:bg-gdb-focus",
                alLado ? "top-1/2 left-[1px] h-8 w-[3px] -translate-y-1/2" : "top-[1px] left-1/2 h-[3px] w-8 -translate-x-1/2"
              )}
            />
          </div>
          <div
            className={cn(
              "flex shrink-0 flex-col gap-1.5 px-2 pb-1.5",
              alLado ? "min-w-[280px] pt-1.5" : "min-h-[150px] pt-0.5"
            )}
            // Debajo, el alto guardado es un TOPE (la vista previa mide lo que su SQL; el divisor fija hasta
            // dónde puede crecer una consulta larga); al lado, el ancho es fijo.
            style={
              alLado
                ? { width: `${Math.round(anchoVistaPrevia * 100)}%` }
                : { maxHeight: `${Math.round(altoVistaPrevia * 100)}%` }
            }
            data-testid="consulta-vista-previa"
            data-disposicion={alLado ? "lado" : "debajo"}
          >
            <div className="flex items-center gap-1">
              <span className="truncate text-[12.5px] font-semibold text-gdb-fgstrong" title={seleccionada.name}>
                {seleccionada.name}
              </span>
              <span className="ml-auto flex shrink-0 items-center">
                <BotonIcono icono="edit" titulo="Editar nombre y SQL" onClick={() => setDialogo({ abierto: true, editando: seleccionada })} />
                <BotonIcono icono="delete" titulo="Eliminar" peligro onClick={() => setBorrandoId(seleccionada.id)} testid="consulta-eliminar" />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-gdb-fgdim">
              <span className="inline-flex h-5 items-center gap-1 rounded bg-gdb-hover px-1.5 text-gdb-fg">
                <IconoMotor tipo={perfilSeleccionada?.type} className="size-3" />
                {perfilSeleccionada?.name ?? seleccionada.connectionId ?? "Sin conexión"}
                {seleccionada.database ? ` · ${seleccionada.database}` : ""}
              </span>
              <span className="inline-flex h-5 items-center rounded border border-gdb-sep px-1.5" title={fechaCompleta(seleccionada.updatedAt)}>
                Modificada {fechaRelativa(seleccionada.updatedAt)}
              </span>
              <span className="inline-flex h-5 items-center rounded border border-gdb-sep px-1.5" title={fechaCompleta(seleccionada.createdAt)}>
                Creada {fechaCompleta(seleccionada.createdAt).split(",")[0]}
              </span>
            </div>
            <SqlNumerado sql={seleccionada.sql} dialecto={dialectoDeMotor(perfilSeleccionada?.type)} ajustar={!alLado} />
            <div className="flex flex-wrap items-center gap-1">
              <Button size="xs" onClick={() => abrir(seleccionada)} data-testid="consulta-abrir">
                <IjIcon name="console" />
                Abrir en la consola
              </Button>
              <Button size="xs" variant="outline" onClick={() => abrir(seleccionada, { ejecutar: true })} data-testid="consulta-ejecutar">
                <IjIcon name="run" />
                Ejecutar
              </Button>
              <Button size="xs" variant="ghost" onClick={() => abrir(seleccionada, { nueva: true })} data-testid="consulta-abrir-nueva">
                <IjIcon name="openInToolWindow" />
                Consola nueva
              </Button>
            </div>
          </div>
        </>
      )}
      {/* Lado a lado y sin selección: el hueco de la vista previa dice qué va ahí (si no, la lista
          se estira a todo el ancho y el SQL «aparece» de golpe al primer clic). */}
      {alLado && !seleccionada && grupos.length > 0 && (
        <div
          className="flex shrink-0 items-center justify-center border-l border-gdb-border px-4 text-center text-[11px] text-gdb-fgdim"
          style={{ width: `${Math.round(anchoVistaPrevia * 100)}%` }}
        >
          Selecciona una consulta para ver su SQL
        </div>
      )}
      </div>

      {/* Pie: los atajos de la lista (la única ayuda permanente; las etiquetas no los repiten). */}
      <div className="flex h-[22px] shrink-0 items-center gap-1.5 overflow-hidden border-t border-gdb-sep px-2 text-[10px] whitespace-nowrap text-gdb-fgdim">
        <span>⏎ abrir</span>
        <span className="text-gdb-muted">·</span>
        <span>⌘⏎ ejecutar</span>
        <span className="text-gdb-muted">·</span>
        <span>F2 renombrar</span>
        <span className="text-gdb-muted">·</span>
        <span>⌫ eliminar</span>
      </div>

      <SaveQueryDialog
        open={dialogo.abierto}
        onOpenChange={(abierto) => setDialogo((d) => ({ ...d, abierto }))}
        initialName={dialogo.editando?.name ?? ""}
        initialSql={dialogo.editando?.sql ?? console_.sql}
        queryId={dialogo.editando?.id}
        connectionId={conexionNombre}
        profileId={conexionProfileId}
        database={conexionDeLaConsola?.database}
        onSaved={(guardada) => {
          dispatch({ type: "UPSERT_SAVED_QUERY", payload: guardada });
          setSeleccionId(guardada.id);
          // Guardar la consola como consulta la deja ligada a ella (el punto ámbar ya sabe de qué).
          if (!dialogo.editando) {
            dispatch({
              type: "SET_ACTIVE_SAVED_QUERY",
              payload: { id: guardada.id, sql: guardada.sql, name: guardada.name },
            });
          }
        }}
      />
    </div>
  );
}

/* ─── Una fila ─────────────────────────────────────────────────────────────────── */

interface FilaProps {
  consulta: SavedQuery;
  sangria: boolean;
  busqueda: string;
  seleccionada: boolean;
  activa: boolean;
  sucia: boolean;
  renombrando: boolean;
  borrando: boolean;
  onSeleccionar: () => void;
  onAbrir: (opciones?: { ejecutar?: boolean; nueva?: boolean }) => void;
  onRenombrar: () => void;
  onConfirmarRenombre: (nombre: string) => void;
  onCancelarRenombre: () => void;
  onEditar: () => void;
  onPedirBorrado: () => void;
  onConfirmarBorrado: () => void;
  onCancelarBorrado: () => void;
}

function FilaDeConsulta({
  consulta,
  sangria,
  busqueda,
  seleccionada,
  activa,
  sucia,
  renombrando,
  borrando,
  onSeleccionar,
  onAbrir,
  onRenombrar,
  onConfirmarRenombre,
  onCancelarRenombre,
  onEditar,
  onPedirBorrado,
  onConfirmarBorrado,
  onCancelarBorrado,
}: FilaProps) {
  const linea = lineaCoincidente(consulta, busqueda);

  if (borrando) {
    // Confirmación EN LA FILA: no abre diálogo ni tapa la lista. El foco va a «Cancelar» (lo
    // seguro); ⎋ también cancela.
    return (
      <div
        className="mx-1.5 my-1 rounded border border-gdb-dangerborder bg-gdb-dangerbg px-2 py-1.5"
        data-testid="consulta-confirmar-borrado"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancelarBorrado();
          }
        }}
      >
        <p className="truncate text-[11.5px] text-gdb-dangerfg">¿Eliminar «{consulta.name}»?</p>
        <div className="mt-1.5 flex gap-1">
          <Button size="xs" variant="destructive" onClick={onConfirmarBorrado} data-testid="consulta-confirmar-eliminar">
            Eliminar
          </Button>
          <Button size="xs" variant="outline" onClick={onCancelarBorrado} autoFocus>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="option"
      aria-selected={seleccionada}
      data-consulta={consulta.id}
      data-testid="consulta-fila"
      onClick={onSeleccionar}
      onDoubleClick={() => onAbrir()}
      className={cn(
        "group relative grid cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-1.5 pr-1.5 text-[12px]",
        sangria ? "pl-[26px]" : "pl-2.5",
        linea ? "min-h-[40px] py-0.5" : "h-[26px]",
        seleccionada ? "bg-gdb-listsel text-gdb-fgstrong" : "hover:bg-gdb-hover"
      )}
    >
      {/* Barra de acento: la consulta cargada en la consola con foco. */}
      <span className={cn("absolute inset-y-0 left-0 w-0.5", activa && "bg-gdb-focus")} aria-hidden data-activa={activa ? "si" : "no"} />
      <IjIcon name="console" className={cn(linea && "mt-[5px] self-start")} />
      <div className="min-w-0">
        {renombrando ? (
          <input
            autoFocus
            defaultValue={consulta.name}
            aria-label="Nuevo nombre"
            data-testid="consulta-renombrar"
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirmarRenombre(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelarRenombre();
              }
            }}
            onBlur={(e) => onConfirmarRenombre(e.currentTarget.value)}
            className="h-[20px] w-full rounded border border-gdb-focus bg-gdb-editor px-1 text-[12px] text-gdb-fg outline-none"
          />
        ) : (
          <div className="truncate" data-testid="consulta-nombre" title={consulta.name}>
            <Resaltado texto={consulta.name} termino={busqueda} />
          </div>
        )}
        {linea && !renombrando && (
          <div className="truncate font-jetbrains text-[10px] leading-tight text-gdb-fgdim" data-testid="consulta-linea-sql">
            <Resaltado texto={linea} termino={busqueda} />
          </div>
        )}
      </div>
      {/* Metadatos (se ocultan con el hover, donde aparecen las acciones). */}
      <div className={cn("flex items-center gap-1.5 group-hover:hidden", linea && "mt-[5px] self-start")}>
        {sucia && (
          <span className="size-[5px] rounded-full bg-gdb-warn" title="Cambios sin guardar en la consola" data-testid="consulta-sucia" />
        )}
        <span className={cn("text-[10.5px] whitespace-nowrap tabular-nums", seleccionada ? "text-gdb-fg" : "text-gdb-fg/75")}>
          {fechaRelativa(consulta.updatedAt)}
        </span>
      </div>
      <div className={cn("hidden items-center group-hover:flex", linea && "self-start")} onClick={(e) => e.stopPropagation()}>
        <BotonIcono icono="run" titulo="Ejecutar (⌘⏎)" onClick={() => onAbrir({ ejecutar: true })} testid="consulta-fila-ejecutar" />
        <BotonIcono icono="openInToolWindow" titulo="Abrir en consola nueva" onClick={() => onAbrir({ nueva: true })} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                title="Más acciones"
                aria-label="Más acciones"
                className="grid size-[22px] place-items-center rounded text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
              >
                <IjIcon name="moreHorizontal" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onAbrir()} className="gap-2">
                <IjIcon name="console" />
                <span className="flex-1">Abrir en la consola</span>
                <DropdownMenuShortcut>⏎</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAbrir({ ejecutar: true })} className="gap-2">
                <IjIcon name="run" />
                <span className="flex-1">Ejecutar</span>
                <DropdownMenuShortcut>⌘⏎</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAbrir({ nueva: true })} className="gap-2">
                <IjIcon name="openInToolWindow" />
                <span className="flex-1">Abrir en consola nueva</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onRenombrar} className="gap-2">
                <IjIcon name="edit" />
                <span className="flex-1">Renombrar</span>
                <DropdownMenuShortcut>F2</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEditar} className="gap-2">
                <IjIcon name="edit" />
                <span className="flex-1">Editar nombre y SQL…</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={onPedirBorrado} className="gap-2">
                <IjIcon name="delete" />
                <span className="flex-1">Eliminar</span>
                <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
