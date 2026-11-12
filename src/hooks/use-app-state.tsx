import * as React from "react";
import {
  type AppState,
  type AppAction,
  type SqlConsole,
  type TableTab,
  type Session,
} from "@/lib/types";
import {
  loadCachedFavorites,
} from "@/lib/favorites-cache";
import { getFavorites, setFavorites } from "@/lib/api";
import { getAiSettings } from "@/lib/ai";
import {
  bindingFromSession,
  persistConsoles,
  restoreConsoles,
  refrescarPerfilEnConsolas,
  type PersistedConsoleSnapshot,
} from "@/lib/console-binding";

const SESSION_STORAGE_KEY = "gestordb_session";
// Snapshot de las consolas (id, nombre, sql y sesión) para restaurar TODAS las
// conexiones abiertas al recargar la página. Reemplaza al viejo formato que solo
// guardaba una única Session global.
const CONSOLES_STORAGE_KEY = "gestordb_consoles";
const INITIAL_CONSOLE_ID = "console-1";

function emptyConsole(id: string, name: string): SqlConsole {
  return {
    id,
    name,
    sql: "",
    // Una consola nueva nace SIN conexión: el usuario elige a qué perfil
    // conectarla después (no hereda la sesión de la consola actual).
    session: null,
    binding: null,
    resultTabs: [],
    activeResultTabId: null,
    activeSavedQueryId: null,
    savedQuerySnapshot: "",
  };
}

const initialState: AppState = {
  schema: null,
  databases: [],
  consoles: [emptyConsole(INITIAL_CONSOLE_ID, "Consola 1")],
  activeConsoleId: INITIAL_CONSOLE_ID,
  queryError: null,
  running: false,
  tableContext: null,
  tableTabs: [],
  activeTabId: "sql",
  commandOpen: false,
  savedQueries: [],
  queryHistory: [],
  favoriteTables: [],
  statusMessage: "",
  transactionActive: false,
  aiMessages: [],
  aiBusy: false,
  aiSettings: null,
};

/**
 * Snapshot persistido por consola: lo mínimo para restaurar las conexiones
 * abiertas y el buffer SQL al recargar. Las pestañas de resultado NO se
 * persisten (los result sets se re-ejecutan bajo demanda).
 */
type PersistedConsole = PersistedConsoleSnapshot;

interface PersistedWorkspace {
  consoles: PersistedConsole[];
  activeConsoleId: string;
}

function loadPersistedWorkspace(): PersistedWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSOLES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWorkspace;
      if (parsed?.consoles?.length) return parsed;
    }
    // Migración del formato antiguo (una sola Session global): si existe,
    // la colocamos en la primera consola para no perder la conexión abierta.
    const legacy = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (legacy) {
      const session = JSON.parse(legacy) as Session;
      return {
        consoles: [
          {
            id: INITIAL_CONSOLE_ID,
            name: "Consola 1",
            sql: "",
            session,
            activeSavedQueryId: null,
            savedQuerySnapshot: "",
          },
        ],
        activeConsoleId: INITIAL_CONSOLE_ID,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Todas las acciones "de consola" (SET_SQL, ADD_RESULT_TAB, etc) operan
 * implícitamente sobre `state.activeConsoleId` — así ningún call-site
 * existente (schema-tree, query-history, saved-queries, sql-editor) tiene
 * que pasar un consoleId explícito, y el único cambio real de esos
 * componentes es leer `useActiveConsole()` en vez de `state.sql` etc.
 */
function updateActiveConsole(
  state: AppState,
  updater: (console: SqlConsole) => SqlConsole
): AppState {
  return {
    ...state,
    consoles: state.consoles.map((c) =>
      c.id === state.activeConsoleId ? updater(c) : c
    ),
  };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SESSION": {
      // La sesión vive dentro de la consola: si el payload no trae `consoleId`,
      // aplicamos a la consola activa (caso más común: conectar/desconectar la
      // consola con foco). Si lo trae, apunta a esa consola concreta (p. ej.
      // una reconexión disparada por un ref que capturó el id de origen).
      const { consoleId, session } = action.payload;
      const targetId = consoleId ?? state.activeConsoleId;
      // R91: una sesión NUEVA renueva la conexión dormida (perfil + base actuales); una sesión que se
      // pierde (`null`: expiró, o el worker se reinició) la CONSERVA — la consola sigue atada a su
      // perfil y se reconecta al ejecutar. Quitarla del todo es `DISCONNECT_CONSOLE`.
      return {
        ...state,
        consoles: state.consoles.map((c) =>
          c.id === targetId
            ? { ...c, session, binding: session ? (bindingFromSession(session) ?? c.binding) : c.binding }
            : c
        ),
      };
    }
    case "SET_BINDING": {
      const targetId = action.payload.consoleId ?? state.activeConsoleId;
      return {
        ...state,
        consoles: state.consoles.map((c) =>
          c.id === targetId ? { ...c, binding: action.payload.binding } : c
        ),
      };
    }
    case "REFRESCAR_PERFIL":
      return { ...state, consoles: refrescarPerfilEnConsolas(state.consoles, action.payload) };
    case "SET_SCHEMA":
      return { ...state, schema: action.payload };
    case "SET_DATABASES":
      return { ...state, databases: action.payload };
    case "SET_SQL":
      return updateActiveConsole(state, (c) => ({ ...c, sql: action.payload }));
    case "ADD_RESULT_TAB": {
      const tab = action.payload;
      return {
        ...updateActiveConsole(state, (c) => {
          const exists = c.resultTabs.find((t) => t.id === tab.id);
          const tabs = exists
            ? c.resultTabs.map((t) => (t.id === tab.id ? tab : t))
            : [...c.resultTabs, tab];
          return { ...c, resultTabs: tabs, activeResultTabId: tab.id };
        }),
        queryError: null,
      };
    }
    case "CLOSE_RESULT_TAB": {
      const id = action.payload;
      return updateActiveConsole(state, (c) => {
        const tabs = c.resultTabs.filter((t) => t.id !== id);
        let activeResultTabId = c.activeResultTabId;
        if (activeResultTabId === id) {
          activeResultTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
        }
        return { ...c, resultTabs: tabs, activeResultTabId };
      });
    }
    case "SET_ACTIVE_RESULT_TAB":
      return updateActiveConsole(state, (c) => ({
        ...c,
        activeResultTabId: action.payload,
      }));
    case "CLEAR_RESULT_TABS":
      return updateActiveConsole(state, (c) => ({
        ...c,
        resultTabs: [],
        activeResultTabId: null,
      }));
    case "SET_QUERY_ERROR":
      return { ...state, queryError: action.payload };
    case "SET_RUNNING":
      return { ...state, running: action.payload };
    case "SET_TABLE_CONTEXT":
      return { ...state, tableContext: action.payload };
    case "OPEN_TABLE_TAB": {
      const { schema, table, whereColumn, whereValue } = action.payload;
      const existing = state.tableTabs.find(
        (t) =>
          t.target.schema === schema &&
          t.target.table === table &&
          t.target.whereColumn === whereColumn &&
          t.target.whereValue === whereValue
      );
      if (existing) {
        return { ...state, activeTabId: existing.id };
      }
      const id = whereColumn
        ? `${schema}.${table}?${Date.now().toString(36)}`
        : `${schema}.${table}`;
      const tab: TableTab = { id, kind: "table", target: { schema, table, whereColumn, whereValue } };
      return {
        ...state,
        tableTabs: [...state.tableTabs, tab],
        activeTabId: id,
      };
    }
    case "CLOSE_TABLE_TAB": {
      const id = action.payload;
      const tabs = state.tableTabs.filter((t) => t.id !== id);
      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : "sql";
      }
      return { ...state, tableTabs: tabs, activeTabId };
    }
    case "SET_ACTIVE_TAB":
      return { ...state, activeTabId: action.payload };
    case "CLOSE_ALL_TABS":
      return { ...state, tableTabs: [], activeTabId: "sql", tableContext: null };
    case "SET_COMMAND_OPEN":
      return { ...state, commandOpen: action.payload };
    case "SET_SAVED_QUERIES":
      return { ...state, savedQueries: action.payload };
    case "UPSERT_SAVED_QUERY": {
      const query = action.payload;
      const exists = state.savedQueries.some((q) => q.id === query.id);
      const savedQueries = exists
        ? state.savedQueries.map((q) => (q.id === query.id ? query : q))
        : [...state.savedQueries, query];
      return { ...state, savedQueries };
    }
    case "SET_QUERY_HISTORY":
      return { ...state, queryHistory: action.payload };
    case "ADD_QUERY_HISTORY_ENTRY": {
      const history = [action.payload, ...state.queryHistory];
      if (history.length > 50) history.length = 50;
      return { ...state, queryHistory: history };
    }
    case "CLEAR_QUERY_HISTORY":
      return { ...state, queryHistory: [] };
    case "TOGGLE_FAVORITE_TABLE": {
      const key = `${action.payload.schema}.${action.payload.table}`;
      const exists = state.favoriteTables.some(
        (f) => `${f.schema}.${f.table}` === key
      );
      const favoriteTables = exists
        ? state.favoriteTables.filter(
            (f) => `${f.schema}.${f.table}` !== key
          )
        : [...state.favoriteTables, action.payload];
      return { ...state, favoriteTables };
    }
    case "SET_FAVORITE_TABLES":
      return { ...state, favoriteTables: action.payload };
    case "SET_STATUS_MESSAGE":
      return { ...state, statusMessage: action.payload };
    case "SET_ACTIVE_SAVED_QUERY":
      return updateActiveConsole(state, (c) => ({
        ...c,
        activeSavedQueryId: action.payload.id,
        savedQuerySnapshot: action.payload.sql,
        ...(action.payload.name ? { name: action.payload.name } : {}),
      }));
    case "SET_TRANSACTION_ACTIVE":
      return { ...state, transactionActive: action.payload };
    case "NEW_CONSOLE": {
      const { id, name } = action.payload;
      const console = emptyConsole(
        id,
        name ?? `Consola ${state.consoles.length + 1}`
      );
      return {
        ...state,
        consoles: [...state.consoles, console],
        activeConsoleId: id,
        activeTabId: "sql",
        queryError: null,
      };
    }
    case "CLOSE_CONSOLE": {
      const id = action.payload;
      // No permitimos cerrar la última consola: siempre debe quedar al
      // menos una, igual que las pestañas de un IDE convencional.
      if (state.consoles.length <= 1) return state;
      const index = state.consoles.findIndex((c) => c.id === id);
      if (index === -1) return state;
      const consoles = state.consoles.filter((c) => c.id !== id);
      let activeConsoleId = state.activeConsoleId;
      if (activeConsoleId === id) {
        const neighborIndex = Math.min(index, consoles.length - 1);
        activeConsoleId = consoles[neighborIndex].id;
      }
      return { ...state, consoles, activeConsoleId };
    }
    case "SET_ACTIVE_CONSOLE":
      return { ...state, activeConsoleId: action.payload, activeTabId: "sql" };
    case "RENAME_CONSOLE":
      return {
        ...state,
        consoles: state.consoles.map((c) =>
          c.id === action.payload.id ? { ...c, name: action.payload.name } : c
        ),
      };
    case "OPEN_SQL_LOG_TAB": {
      // Fase 3 (T7): una sola pestaña de log; si ya está abierta, solo se activa.
      const id = "sql-log";
      if (state.tableTabs.some((t) => t.id === id)) return { ...state, activeTabId: id };
      const tab: TableTab = { id, kind: "sqlLog", target: { schema: "", table: "" } };
      return { ...state, tableTabs: [...state.tableTabs, tab], activeTabId: id };
    }
    case "OPEN_DIAGRAM_TAB": {
      const { schema, table, scopeTables } = action.payload;
      const scopeKey = scopeTables
        ? scopeTables
            .map((t) => `${t.schema}.${t.table}`)
            .sort()
            .join(",")
        : "";
      const id = scopeKey ? `er:scope:${scopeKey}` : `er:${schema}.${table}`;
      const exists = state.tableTabs.find((t) => t.id === id);
      if (exists) {
        return { ...state, activeTabId: id };
      }
      const tab: TableTab = {
        id,
        kind: "diagram",
        target: { schema, table },
        scopeTables,
      };
      return {
        ...state,
        tableTabs: [...state.tableTabs, tab],
        activeTabId: id,
      };
    }
    case "DISCONNECT_CONSOLE": {
      // Desconecta una sola consola: le quita la sesión y limpia sus result
      // tabs. Las otras consolas y sus conexiones quedan intactas.
      const targetId = action.payload.consoleId ?? state.activeConsoleId;
      return {
        ...state,
        consoles: state.consoles.map((c) =>
          c.id === targetId
            ? // Desconectar A PROPÓSITO suelta también la conexión dormida (R91): la consola queda
              // «Sin conexión» y no se reconecta sola al ejecutar.
              { ...c, session: null, binding: null, resultTabs: [], activeResultTabId: null }
            : c
        ),
      };
    }
    case "RESTORE_WORKSPACE": {
      // Reconstruimos las consolas persistidas. Los result tabs no se persisten,
      // así que arrancan vacíos; el resto (sql, sesión, consulta guardada) se
      // restaura tal cual. Si por alguna razón no viene ninguna consola,
      // dejamos el estado como está para no romper la invariante de >= 1 consola.
      if (action.payload.consoles.length === 0) return state;
      // R91: SIN sesión (la guardada murió con el worker) y con la conexión dormida.
      const consoles: SqlConsole[] = restoreConsoles(action.payload.consoles);
      const activeConsoleId = consoles.some(
        (c) => c.id === action.payload.activeConsoleId
      )
        ? action.payload.activeConsoleId
        : consoles[0].id;
      return { ...state, consoles, activeConsoleId };
    }
    case "RESET_WORKSPACE": {
      const id = crypto.randomUUID();
      return {
        ...state,
        consoles: [emptyConsole(id, "Consola 1")],
        activeConsoleId: id,
        queryError: null,
        running: false,
        tableContext: null,
        tableTabs: [],
        activeTabId: "sql",
        commandOpen: false,
        statusMessage: "",
        transactionActive: false,
        aiMessages: [],
        aiBusy: false,
      };
    }
    case "SET_AI_BUSY":
      return { ...state, aiBusy: action.payload };
    case "ADD_AI_MESSAGE": {
      const messages = [action.payload, ...state.aiMessages];
      if (messages.length > 50) messages.length = 50;
      return { ...state, aiMessages: messages };
    }
    case "SET_AI_MESSAGES":
      return { ...state, aiMessages: action.payload };
    case "APPEND_AI_STREAM_CHUNK": {
      const latest = state.aiMessages[0];
      if (!latest || latest.role !== "assistant") {
        return {
          ...state,
          aiMessages: [
            { role: "assistant", content: action.payload, at: new Date().toISOString() },
            ...state.aiMessages,
          ],
        };
      }
      const updated = { ...latest, content: latest.content + action.payload };
      return { ...state, aiMessages: [updated, ...state.aiMessages.slice(1)] };
    }
    case "CLEAR_AI_MESSAGES":
      return { ...state, aiMessages: [] };
    case "SET_AI_SETTINGS":
      return { ...state, aiSettings: action.payload };
    case "SET_AI_LAST_USAGE":
      return { ...state, aiLastUsage: action.payload };
    case "SET_LATEST_AI_MESSAGE_COST": {
      // Adjunta el costo real (USD) reportado por OpenRouter al último
      // mensaje del asistente, para poder sumar el gasto acumulado del chat
      // completo (persistido con el historial) sin importar si el modelo
      // cambió entre turnos — cada mensaje lleva su propio costo real.
      const latest = state.aiMessages[0];
      if (!latest || latest.role !== "assistant") return state;
      const updated = { ...latest, costUsd: action.payload.costUsd };
      return { ...state, aiMessages: [updated, ...state.aiMessages.slice(1)] };
    }
    default:
      return state;
  }
}

/** Devuelve la consola activa, con fallback a la primera si el id quedó desincronizado. */
export function getActiveConsole(state: AppState): SqlConsole {
  return (
    state.consoles.find((c) => c.id === state.activeConsoleId) ??
    state.consoles[0]
  );
}

const AppStateContext = React.createContext<AppState | null>(null);
const AppDispatchContext = React.createContext<React.Dispatch<AppAction> | null>(null);
const HydratedContext = React.createContext<boolean>(false);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const workspace = loadPersistedWorkspace();
    if (workspace) {
      // Restauramos las consolas persistidas (con sus sesiones). La
      // re-validación de cada sesión contra el server se hace por-consola en
      // app-shell.tsx; aquí solo repoblamos el estado local.
      dispatch({ type: "RESTORE_WORKSPACE", payload: workspace });
      // Fase 84: los favoritos ya NO se cargan aquí. Se cargan por PERFIL en su propio efecto,
      // cuando la sesión activa ya tiene `profileId` (al hidratar todavía puede no haberla).
    }
    // Necesario para evitar hydration mismatch: el servidor renderiza sin
    // localStorage y el cliente restaura el workspace después de hidratar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    getAiSettings()
      .then((settings) => {
        if (mounted) {
          dispatch({ type: "SET_AI_SETTINGS", payload: settings });
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  // Persistencia del workspace completo (todas las consolas con su sesión y su
  // buffer SQL) para restaurar cada conexión abierta al recargar. Solo tras
  // hidratar, para no pisar el localStorage con el estado inicial vacío.
  React.useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedWorkspace = {
      // R91: se guarda la conexión DORMIDA de cada consola, no la sesión (su id no sobrevive).
      consoles: persistConsoles(state.consoles),
      activeConsoleId: state.activeConsoleId,
    };
    window.localStorage.setItem(CONSOLES_STORAGE_KEY, JSON.stringify(payload));
    // Limpiamos la clave del formato antiguo una vez migrado.
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [hydrated, state.consoles, state.activeConsoleId]);

  /**
   * Fase 84 — favoritos POR PERFIL, en disco.
   *
   * Antes: `localStorage` con clave `nombre:tipo:base` de la sesión y guardado en CADA cambio de
   * estado. Eso se rompía de tres maneras (clave que cambia al cambiar de base o renombrar, un solo
   * array compartido por todas las consolas, y `[]` escrito al arrancar antes de cargar). Ver
   * `src/server/favorites.ts`.
   *
   * Ahora: se cargan al aparecer el perfil de la sesión activa y se guardan SOLO cuando la lista
   * cambia de verdad (la firma evita el guardado inicial que borraba lo que había).
   */
  const perfilCargadoRef = React.useRef<string | null>(null);
  const firmaFavoritosRef = React.useRef<string | null>(null);
  /**
   * Estado actual en un ref, para leer la sesión desde dentro del efecto SIN poner `state` en las
   * dependencias. Con `state` en las deps el efecto se re-ejecutaba en cada cambio y el guardia de
   * cancelación anulaba la lectura pendiente: los favoritos se leían y **nunca** llegaban al estado.
   */
  const estadoRef = React.useRef(state);
  // Actualizar el ref en un efecto (mutarlo en render está prohibido por el lint del repo).
  React.useEffect(() => {
    estadoRef.current = state;
  }, [state]);

  // R91: con la consola dormida el perfil sale de su conexión guardada (los favoritos no necesitan sesión).
  const perfilActivo =
    getActiveConsole(state).session?.profileId ?? getActiveConsole(state).binding?.profileId ?? null;

  React.useEffect(() => {
    const perfil = perfilActivo;
    if (!perfil || perfilCargadoRef.current === perfil) return;
    perfilCargadoRef.current = perfil;
    (async () => {
      try {
        let { favoritos } = await getFavorites(perfil);
        if (favoritos.length === 0) {
          // Migración única desde la clave vieja de `localStorage`: los favoritos que el usuario ya
          // tenía no se pierden con este cambio.
          const sesion = getActiveConsole(estadoRef.current).session;
          const legado = sesion ? loadCachedFavorites(sesion) : [];
          if (legado.length > 0) {
            favoritos = legado;
            await setFavorites(perfil, legado);
          }
        }
        // Si el usuario ya cambió a otro perfil mientras se leía, esta respuesta es vieja.
        if (perfilCargadoRef.current !== perfil) return;
        // La firma se fija ANTES de despachar para que el efecto de guardado no lo tome por un cambio.
        firmaFavoritosRef.current = JSON.stringify(favoritos);
        dispatch({ type: "SET_FAVORITE_TABLES", payload: favoritos });
      } catch (err) {
        // Sin favoritos guardados (o sin disco) el árbol sigue funcionando: es una comodidad.
        console.error("[favoritos] no se pudieron leer", err);
      }
    })();
  }, [perfilActivo]);

  React.useEffect(() => {
    if (!perfilActivo) return;
    const firma = JSON.stringify(state.favoriteTables);
    // Primera firma = el estado con el que se arranca; guardarlo borraría lo del disco antes de leerlo.
    if (firmaFavoritosRef.current === null) {
      firmaFavoritosRef.current = firma;
      return;
    }
    if (firmaFavoritosRef.current === firma) return;
    firmaFavoritosRef.current = firma;
    void setFavorites(perfilActivo, state.favoriteTables).catch(() => {
      // Si falla el guardado se avisa en la barra de estado, no se traga en silencio.
      dispatch({ type: "SET_STATUS_MESSAGE", payload: "No se pudieron guardar los favoritos" });
    });
  }, [perfilActivo, state.favoriteTables]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <HydratedContext.Provider value={hydrated}>
          {children}
        </HydratedContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = React.useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}

export function useAppDispatch(): React.Dispatch<AppAction> {
  const context = React.useContext(AppDispatchContext);
  if (!context) {
    throw new Error("useAppDispatch must be used within AppProvider");
  }
  return context;
}

export function useHydrated(): boolean {
  return React.useContext(HydratedContext);
}

/** Consola SQL actualmente activa (independiente de qué tab visual esté mostrando). */
export function useActiveConsole(): SqlConsole {
  const state = useAppState();
  return getActiveConsole(state);
}

/**
 * Sesión de la consola con foco (o `null` si no está conectada). Atajo para los
 * componentes que solo necesitan la sesión activa y no el resto de la consola;
 * así el diff al migrar de `state.session` es mínimo.
 */
export function useActiveSession(): Session | null {
  const state = useAppState();
  return getActiveConsole(state).session;
}
