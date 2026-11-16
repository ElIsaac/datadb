import * as React from "react";
import { showToolWindow } from "@/shell/layout-store";
import { toast } from "sonner";
import { format as formatSql } from "sql-formatter";
import { useAppState, useAppDispatch, useActiveConsole } from "@/hooks/use-app-state";
import { runQuery as apiRunQuery, cancelQuery as apiCancelQuery, cancelOperation as apiCancelOperation, updateSavedQuery as apiUpdateSavedQuery, explainQuery as apiExplainQuery } from "@/lib/api";
import { askAi, makeUserChatMessage, makeAssistantChatMessage } from "@/lib/ai";
import { parseSingleTable } from "@/lib/sql-parser";
import { contextoDesdeOrigenes, tieneOrigenes } from "@/lib/result-origin";
import { resolveTableInSchema, extractScopeTables } from "@/lib/sql-scope";
import { getActiveStatement, getActiveStatementBounds, getStatementRangeAt, splitStatements } from "@/lib/sql-statements";
import { SaveQueryDialog } from "@/components/saved-queries";
import { ConfirmRiskyQueryDialog } from "@/components/confirm-risky-query-dialog";
import { AiSqlDialog } from "@/components/ai-sql-dialog";
import { AiFixPreview } from "@/components/ai-fix-preview";
import { AiConvertDialog } from "@/components/ai-convert-dialog";
import { detectSqlRisks, type SqlRisk } from "@/lib/sql-safety";
import { buildSqlDiagnostics, type SqlLintDiagnostic } from "@/lib/sql-lint";
import { OwnEditor, type OwnEditorHandle } from "@/components/own-editor/own-editor";
import { adaptadorDeConsolaProxy, type ConsolaView } from "@/components/own-editor/consola-adapter";
import { contextualSuggestions } from "@/lib/sql-completion";
import type { QueryHistoryEntry, QueryResult, SavedQuery, Session, TableContext, TableMeta } from "@/lib/types";
import { wakeBinding } from "@/lib/console-wake";
import { IjIcon } from "@/components/ij-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { connectionOf } from "@/lib/console-binding";
import { dialectoSql } from "@/shared/connection-net";

const RUN_QUERY_EVENT = "cm-run-query";
const OPEN_ER_DIAGRAM_EVENT = "cm-open-er-diagram";
const OPEN_ER_DIAGRAM_SCOPE_EVENT = "cm-open-er-diagram-scope";
const SAVE_QUERY_EVENT = "cm-save-query";
const FORMAT_SQL_EVENT = "cm-format-sql";
const EXPLAIN_QUERY_EVENT = "cm-explain-query";
const AI_SQL_EVENT = "cm-ai-sql";

/**
 * Tabla referenciada bajo el cursor, para «Ir a la tabla» y el ER del ámbito.
 *
 * Antes vivía aquí y hablaba con `EditorView` de CodeMirror. Ahora usa la vista que expone el
 * adaptador (`ConsolaView`), que tiene las mismas piezas que la consola ya usaba: el texto, la
 * selección y `wordAt`. Al ser un tipo propio, este archivo ya no importa nada de CodeMirror.
 */
function getTableReferenceAtCursor(
  view: ConsolaView
): { schema?: string; table: string } | null {
  const pos = view.state.selection.main.head;
  const word = view.state.wordAt(pos);
  if (!word || word.from === word.to) return null;
  const texto = view.state.doc.toString();
  const table = texto.slice(word.from, word.to).replace(/^["`[]|["`\]]$/g, "");
  if (!table) return null;
  const before = texto.slice(0, word.from);
  const schemaMatch = before.match(/(?:["`[])?([a-zA-Z_][a-zA-Z0-9_]*)(?:["`\]])?\.$/);
  const schema = schemaMatch ? schemaMatch[1] : undefined;
  return { schema, table };
}

export function SqlEditor({ txMode = "auto" }: { txMode?: "auto" | "manual" }) {
  const state = useAppState();
  /*
    R92 — columnas con su propio color. El lexer del editor (`highlight.ts`) no conoce el esquema: se
    le pasan aquí los nombres de COLUMNA y de TABLA del esquema conectado (en minúsculas) para que
    pinte la columna con el token `col` y deje tablas y alias como están. Se memoiza por `schema`:
    el editor recibe referencias estables y no re-colorea en cada pulsación, solo cuando cambia el
    esquema (al conectar o al refrescar el árbol).
  */
  const nombresDeEsquema = React.useMemo(() => {
    const columnas = new Set<string>();
    const tablas = new Set<string>();
    for (const nodo of state.schema ?? []) {
      for (const tabla of nodo.tables) {
        tablas.add(tabla.name.toLowerCase());
        for (const columna of tabla.columns) columnas.add(columna.name.toLowerCase());
      }
    }
    return { columnas, tablas };
  }, [state.schema]);
  const dispatch = useAppDispatch();
  const console_ = useActiveConsole();
  // Sesión de la consola con foco: el editor ejecuta/explica/convierte SIEMPRE
  // sobre la conexión de su propia consola, nunca sobre una sesión global.
  const session = console_.session;
  const conexion = connectionOf(console_);
  /**
   * Ya NO hay dos motores: la consola siempre monta el editor propio (decisión del usuario,
   * 2026-10-20: «quedémonos con el editor y quitemos CodeMirror»). `cmRef` conserva la forma
   * `{ view, editor }` que el adaptador construye, para no reescribir los quince manejadores que ya
   * hablaban con esa forma.
   */
  const cmRef = React.useRef<{ view: ConsolaView; editor: HTMLElement | null } | null>(null);
  /**
   * Spike F2-B — el conmutador de editor de la consola. `propio` monta el editor propio con el
   * ADAPTADOR (`consola-adapter.ts`): expone `{ view, editor }` con la forma que los manejadores
   * existentes ya esperan de CodeMirror, así que ejecutar/formatear/explain/ER/IA no se tocan.
   * El `ref` del editor propio alimenta el mismo `cmRef`: los manejadores leen `cmRef.current.view`
   * y `.editor`, y el adaptador satisface ambos sin distinguir el motor.
   */
  const ownRef = React.useRef<OwnEditorHandle | null>(null);
  const elementRef = React.useRef<HTMLElement | null>(null);

  const sessionRef = React.useRef(session);
  /** R91: la conexión dormida de la consola, para conectar sola al ejecutar. */
  const bindingRef = React.useRef(console_.binding);
  // Fase 3 (T4): opId de la query en curso de ESTA consola (lo usa Cancelar). null = nada en curso.
  const currentOpRef = React.useRef<string | null>(null);
  const sqlRef = React.useRef(console_.sql);
  const consoleIdRef = React.useRef(console_.id);

  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  React.useEffect(() => {
    bindingRef.current = console_.binding;
  }, [console_.binding]);

  /**
   * R91 — la sesión de ESTA consola, abriéndola si la consola está dormida (atada a un perfil y una
   * base pero sin sesión: lo normal al reabrir la app). Conecta el perfil, vuelve a la base guardada
   * y publica la sesión en la consola. `null` si la consola no tiene ninguna conexión elegida.
   */
  const ensureSession = React.useCallback(async (): Promise<Session | null> => {
    if (sessionRef.current) return sessionRef.current;
    const binding = bindingRef.current;
    if (!binding) return null;
    dispatch({ type: "SET_STATUS_MESSAGE", payload: `Conectando a ${binding.name}…` });
    const { session: abierta, databaseError } = await wakeBinding(binding);
    if (databaseError) {
      toast.warning(`No se pudo volver a la base ${binding.database}: ${databaseError}`);
    }
    sessionRef.current = abierta;
    dispatch({ type: "SET_SESSION", payload: { consoleId: consoleIdRef.current, session: abierta } });
    return abierta;
  }, [dispatch]);

  React.useEffect(() => {
    sqlRef.current = console_.sql;
    consoleIdRef.current = console_.id;
  }, [console_.sql, console_.id]);

  const detectContext = React.useCallback(
    (sqlText: string, columnas: QueryResult["columns"]): TableContext | null => {
      // R94: si el motor dijo de dónde sale cada columna (MySQL, Postgres), el contexto sale de
      // AHÍ y no del texto: así un JOIN o un alias se editan como en DataGrip. Cuando hay origen
      // NO se recurre al parseo aunque no salga contexto: el parseo solo mira el nombre de la
      // columna, y con un alias (`SELECT nombre AS email FROM t`) apuntaría a otra columna real.
      if (tieneOrigenes(columnas)) return contextoDesdeOrigenes(columnas, state.schema);
      // MySQL y Postgres SIEMPRE dicen el origen de una columna que sale de una tabla: si ninguna
      // lo trae, el resultado es solo expresiones (`count(*) AS n`) y no hay nada que editar. El
      // parseo del texto queda para los motores que no lo reportan (SQL Server). Medido en la app:
      // sin esta guarda, `select count(*) as n from t` enseñaba «Guardar» y «Agregar».
      const motor = sessionRef.current?.type ?? session?.type;
      if (motor === "mysql" || motor === "postgres") return null;
      const ref = parseSingleTable(sqlText);
      if (!ref || !state.schema) return null;
      const schemaName = ref.schema ?? session?.database ?? "";
      const node = state.schema.find(
        (s) => s.name === schemaName || s.name === ref.schema
      );
      const table =
        node?.tables.find((t) => t.name === ref.table) ??
        state.schema
          .flatMap((s) => s.tables.map((t) => ({ schema: s.name, table: t })))
          .find((item) => item.table.name === ref.table)?.table;
      if (!table || table.columns.filter((c) => c.isPrimaryKey).length !== 1) {
        return null;
      }
      const actualSchema =
        node?.name ??
        state.schema.find((s) => s.tables.some((t) => t.name === ref.table))?.name ??
        schemaName;
      return {
        schema: actualSchema,
        table: table.name,
        pkColumns: table.columns.filter((c) => c.isPrimaryKey),
        columns: table.columns,
      };
    },
    [state.schema, session?.database, session?.type]
  );



  const generateTabTitle = React.useCallback(
    (sqlText: string, index: number): string => {
      // Prioridad máxima: comentario de título explícito al inicio de la
      // sentencia, p.ej. "-- Ventas Q3" o "/* Ventas Q3 */".
      const lineComment = /^\s*--\s*(.+)$/m.exec(sqlText.split(/\n/, 1)[0] ?? "");
      const blockComment = /^\s*\/\*\s*(.+?)\s*\*\//.exec(sqlText);
      const explicitTitle = (lineComment?.[1] ?? blockComment?.[1])?.trim();
      if (explicitTitle) return explicitTitle;

      const ref = parseSingleTable(sqlText);
      if (ref?.table) return ref.table;
      const firstWord = sqlText.trim().split(/\s+/)[0]?.toUpperCase();
      if (firstWord) return `${firstWord} ${index + 1}`;
      return `Resultado ${index + 1}`;
    },
    []
  );

  const executeStatements = React.useCallback(
    async (statements: string[]) => {
      if (statements.length === 0) return;
      dispatch({ type: "SET_RUNNING", payload: true });
      dispatch({ type: "SET_QUERY_ERROR", payload: null });
      // R91: conexión perezosa — con la consola dormida, conectar es el primer paso de ejecutar.
      let session: Session | null;
      try {
        session = await ensureSession();
      } catch (err) {
        dispatch({ type: "SET_RUNNING", payload: false });
        dispatch({ type: "SET_QUERY_ERROR", payload: String(err) });
        dispatch({ type: "SET_STATUS_MESSAGE", payload: String(err) });
        toast.error(`No se pudo conectar: ${String(err)}`);
        return;
      }
      if (!session) {
        dispatch({ type: "SET_RUNNING", payload: false });
        toast.info("Elige una conexión para esta consola");
        return;
      }
      dispatch({ type: "SET_STATUS_MESSAGE", payload: "Ejecutando..." });
      dispatch({ type: "CLEAR_RESULT_TABS" });

      let currentSession = session;

      async function runQueryWithReconnect(
        sqlText: string
      ): Promise<QueryResult> {
        const MAX_RECONNECT = 1;
        for (let attempt = 0; attempt <= MAX_RECONNECT; attempt++) {
          try {
            // Fase 3 (T4): cada intento es una operacion propia; Cancelar corta la que este en curso.
            const opId = crypto.randomUUID();
            currentOpRef.current = opId;
            try {
              return await apiRunQuery(currentSession.sessionId, sqlText, undefined, undefined, opId);
            } finally {
              if (currentOpRef.current === opId) currentOpRef.current = null;
            }
          } catch (err) {
            const msg = String(err);
            const isExpired =
              /session not found/i.test(msg) ||
              /expir/i.test(msg);

            if (!isExpired || attempt >= MAX_RECONNECT || !currentSession.profileId) {
              throw err;
            }

            // Reconectar automáticamente. Apuntamos explícitamente a la consola
            // de este editor por si el foco cambió a otra consola mientras la
            // query estaba en vuelo.
            toast.info("Sesión expirada — reconectando...");
            // R91: reabre el perfil Y la base en la que estaba la consola (antes, la del perfil).
            const { session: newSession } = await wakeBinding({
              profileId: currentSession.profileId,
              database: currentSession.database,
            });
            currentSession = newSession;
            sessionRef.current = newSession;
            dispatch({
              type: "SET_SESSION",
              payload: { consoleId: consoleIdRef.current, session: newSession },
            });
          }
        }
        throw new Error("unreachable");
      }

      let lastContext: TableContext | null = null;
      let executed = 0;
      let lastResult: QueryResult | null = null;

      try {
        for (let i = 0; i < statements.length; i++) {
          const sqlText = statements[i];
          console.log("[run query]", sqlText);
          const res = await runQueryWithReconnect(sqlText);
          lastResult = res;
          const context = detectContext(sqlText, res.columns);
          if (context) lastContext = context;

          const historyEntry: QueryHistoryEntry = {
            id: crypto.randomUUID(),
            sql: sqlText,
            executedAt: new Date().toISOString(),
            durationMs: res.durationMs,
            rowCount: res.rowCount,
            affectedRows: res.affectedRows,
            database: sessionRef.current?.database,
            engine: sessionRef.current?.type,
          };
          dispatch({ type: "ADD_QUERY_HISTORY_ENTRY", payload: historyEntry });

          const tab = {
            id: `${Date.now().toString(36)}-${i}`,
            title: generateTabTitle(sqlText, i),
            sql: sqlText,
            result: res,
            tableContext: context,
          };
          dispatch({ type: "ADD_RESULT_TAB", payload: tab });
          executed++;
        }

        // Fase 70 (T4): el resumen «N filas · X ms» ya vive en la barra fina del panel de
        // resultados, justo encima de la rejilla. La barra de estado dice «Listo»: repetir la
        // misma cifra en dos franjas separadas era ruido (y en la maqueta aprobada no está).
        if (lastResult) {
          dispatch({ type: "SET_STATUS_MESSAGE", payload: "Listo" });
        }
        toast.success(`${executed} query(s) ejecutada(s)`);
        dispatch({ type: "SET_TABLE_CONTEXT", payload: lastContext });
      } catch (err) {
        dispatch({ type: "SET_QUERY_ERROR", payload: String(err) });
        dispatch({ type: "SET_STATUS_MESSAGE", payload: String(err) });
        toast.error(String(err));
      } finally {
        dispatch({ type: "SET_RUNNING", payload: false });
      }
    },
    [dispatch, detectContext, generateTabTitle, ensureSession]
  );

  /**
   * Diagnósticos del editor propio, contra el esquema REAL de la conexión. Con retardo de 300 ms:
   * `buildSqlDiagnostics` recorre el documento entero y no puede correr por pulsación.
   */
  const [diagnosticos, setDiagnosticos] = React.useState<SqlLintDiagnostic[]>([]);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDiagnosticos(buildSqlDiagnostics(console_.sql, state.schema, session?.database));
    }, 300);
    return () => clearTimeout(timer);
  }, [console_.sql, state.schema, session?.database]);

  /**
   * Sugerencias del editor propio, contra el esquema real y SEGÚN EL CONTEXTO del cursor (R89):
   * detrás de `FROM` solo tablas, en la proyección solo las columnas de las tablas de la consulta,
   * detrás de `JOIN`/`ON` las relaciones por clave foránea. Antes se pasaba la lista entera del
   * esquema y el popup solo filtraba por prefijo (ver `src/lib/sql-completion.ts`).
   */
  const suggestContextual = React.useCallback(
    ({ text, offset }: { text: string; offset: number }) =>
      contextualSuggestions({ text, offset, schema: state.schema, defaultSchema: session?.database }),
    [state.schema, session?.database]
  );

  const [riskyStatements, setRiskyStatements] = React.useState<SqlRisk[] | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = React.useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = React.useState("");
  const [convertTarget, setConvertTarget] = React.useState<{ target: "postgres" | "mysql" | "sqlserver"; sql: string } | null>(null);
  const [lintFix, setLintFix] = React.useState<{ sql: string; errorMessage: string } | null>(null);
  const [errorContext, setErrorContext] = React.useState<{ sql: string; errorMessage: string; focusTables: { schema?: string; table: string }[] } | null>(null);
  const pendingStatementsRef = React.useRef<string[] | null>(null);

  /**
   * El falso `ReactCodeMirrorRef` cuando la consola usa el editor propio. Se construye una vez por
   * render y `cmRef.current` lo apunta: los manejadores siguen leyendo `cmRef.current.view` /
   * `cmRef.current.editor` sin enterarse del motor. `own` dice si hay que leerlo.
   */
  // El adaptador se construye en el MÓDULO con los refs crudos (no cierres): las reglas de hooks
  // del linter solo aplican al RENDER, y este `useMemo` solo crea el objeto (las lecturas ocurren
  // cuando el usuario dispara una acción, dentro del adaptador).
  // El adaptador se construye en el EFECTO, no en el render: ahí sí se pueden pasar refs a una
  // función (la regla `react-hooks/refs` aplica al render). Se guarda en estado porque el render lo
  // necesita (el `onAction` del editor propio), y `cmRef.current` lo apunta: los manejadores siguen
  // leyendo `cmRef.current.view` / `.editor` sin enterarse del motor.
  const [adaptador, setAdaptador] = React.useState<
    ReturnType<typeof adaptadorDeConsolaProxy> | null
  >(null);
  React.useEffect(() => {
    const creado = adaptadorDeConsolaProxy(ownRef, elementRef);
    setAdaptador(creado);
    cmRef.current = creado as unknown as { view: ConsolaView; editor: HTMLElement | null };
    return () => {
      cmRef.current = null;
      setAdaptador(null);
    };
  }, []);

  const handleRun = React.useCallback(
    async (mode: "active" | "all" = "active") => {
      // R91: basta con que la consola esté ATADA a una conexión; se abre al ejecutar.
      if (!sessionRef.current && !bindingRef.current) {
        toast.info("Elige una conexión para esta consola");
        return;
      }

      const view = cmRef.current?.view;
      const fullText = view ? view.state.doc.toString() : sqlRef.current;
      const selection = view?.state.selection.main;

      let statements: string[];
      if (mode === "all") {
        statements = splitStatements(fullText);
        if (statements.length === 0) {
          toast.info("No hay queries para ejecutar");
          return;
        }
      } else if (selection && selection.from !== selection.to) {
        statements = splitStatements(fullText.slice(selection.from, selection.to));
      } else if (view) {
        const pos = selection?.head ?? 0;
        const active = getActiveStatement(fullText, pos);
        statements = active ? [active] : [];
      } else {
        statements = splitStatements(fullText);
      }

      if (statements.length === 0) {
        toast.info("Coloca el cursor en una query para ejecutarla");
        return;
      }

      dispatch({ type: "SET_SQL", payload: fullText });

      const risks = detectSqlRisks(statements);
      if (risks.length > 0) {
        pendingStatementsRef.current = statements;
        setRiskyStatements(risks);
        return;
      }

      await executeStatements(statements);
    },
    [dispatch, executeStatements]
  );

  const handleConfirmRiskyRun = React.useCallback(() => {
    const statements = pendingStatementsRef.current;
    pendingStatementsRef.current = null;
    if (statements) void executeStatements(statements);
  }, [executeStatements]);

  const handleCancelQuery = React.useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      // Fase 3 (T4): por id de operacion (R4). Sin operacion registrada (no deberia pasar con el boton visible solo
      // mientras corre) se cae a la cancelacion por sesion de siempre.
      const opId = currentOpRef.current;
      if (opId) await apiCancelOperation(opId);
      else await apiCancelQuery(session.sessionId);
      toast.info("Cancelando consulta...");
    } catch (err) {
      toast.error(`No se pudo cancelar: ${String(err)}`);
    }
  }, []);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => handleRun("active");
    el.addEventListener(RUN_QUERY_EVENT, listener);
    return () => el.removeEventListener(RUN_QUERY_EVENT, listener);
  }, [handleRun, console_.id]);

  const handleOpenErDiagram = React.useCallback(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    const ref = getTableReferenceAtCursor(view);
    if (!ref) {
      toast.info("Coloca el cursor sobre el nombre de una tabla");
      return;
    }
    if (!state.schema) {
      toast.error("No hay schema cargado");
      return;
    }
    const resolved = resolveTableInSchema(
      state.schema,
      ref.table,
      ref.schema,
      session?.database
    );
    if (resolved) {
      dispatch({
        type: "OPEN_DIAGRAM_TAB",
        payload: { schema: resolved.schema, table: resolved.table.name },
      });
    } else {
      toast.error(`No se encontró la tabla "${ref.table}" en el schema`);
    }
  }, [state.schema, session?.database, dispatch]);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => handleOpenErDiagram();
    el.addEventListener(OPEN_ER_DIAGRAM_EVENT, listener);
    return () => el.removeEventListener(OPEN_ER_DIAGRAM_EVENT, listener);
  }, [handleOpenErDiagram, console_.id]);

  const handleOpenErDiagramScope = React.useCallback(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    if (!state.schema) {
      toast.error("No hay schema cargado");
      return;
    }

    const fullText = view.state.doc.toString();
    const pos = view.state.selection.main.head;
    const activeStatement = getActiveStatement(fullText, pos);
    if (!activeStatement) {
      toast.info("Coloca el cursor en una query para ver sus tablas");
      return;
    }

    const scopeTables = extractScopeTables(activeStatement);
    if (scopeTables.length === 0) {
      toast.info("No se encontraron tablas en la consulta con foco");
      return;
    }

    const resolved = scopeTables
      .map((t) =>
        resolveTableInSchema(
          state.schema!,
          t.table,
          t.schema,
          session?.database
        )
      )
      .filter((r): r is { schema: string; table: TableMeta } => r !== null);

    if (resolved.length === 0) {
      toast.error("No se encontraron las tablas de la consulta en el schema");
      return;
    }

    // Dedup por schema.table.
    const seen = new Set<string>();
    const uniqueTargets: { schema: string; table: string }[] = [];
    for (const r of resolved) {
      const key = `${r.schema}.${r.table.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueTargets.push({ schema: r.schema, table: r.table.name });
    }

    dispatch({
      type: "OPEN_DIAGRAM_TAB",
      payload: {
        schema: uniqueTargets[0].schema,
        table: uniqueTargets[0].table,
        scopeTables: uniqueTargets,
      },
    });
  }, [state.schema, session?.database, dispatch]);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => handleOpenErDiagramScope();
    el.addEventListener(OPEN_ER_DIAGRAM_SCOPE_EVENT, listener);
    return () => el.removeEventListener(OPEN_ER_DIAGRAM_SCOPE_EVENT, listener);
  }, [handleOpenErDiagramScope, console_.id]);

  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const activeSavedQueryIdRef = React.useRef(console_.activeSavedQueryId);
  React.useEffect(() => {
    activeSavedQueryIdRef.current = console_.activeSavedQueryId;
  }, [console_.activeSavedQueryId]);

  const handleSaveQuery = React.useCallback(async () => {
    const fullText = cmRef.current?.view?.state.doc.toString() ?? sqlRef.current;
    if (!fullText.trim()) {
      toast.info("No hay nada que guardar");
      return;
    }
    const activeId = activeSavedQueryIdRef.current;
    if (!activeId) {
      // Consulta nueva: abrir modal para elegir nombre.
      setSaveDialogOpen(true);
      return;
    }
    try {
      const updated = await apiUpdateSavedQuery(activeId, { sql: fullText.trim() });
      dispatch({
        type: "SET_ACTIVE_SAVED_QUERY",
        payload: { id: updated.id, sql: updated.sql, name: updated.name },
      });
      dispatch({ type: "UPSERT_SAVED_QUERY", payload: updated });
      toast.success(`Consulta "${updated.name}" guardada`);
    } catch (err) {
      toast.error(String(err));
    }
  }, [dispatch]);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => void handleSaveQuery();
    el.addEventListener(SAVE_QUERY_EVENT, listener);
    return () => el.removeEventListener(SAVE_QUERY_EVENT, listener);
  }, [handleSaveQuery, console_.id]);

  const handleFormatSql = React.useCallback(() => {
    const view = cmRef.current?.view;
    if (!view) return;

    const selection = view.state.selection.main;
    const dialect =
      sessionRef.current?.type === "postgres"
        ? "postgresql"
        : sessionRef.current?.type === "sqlserver"
          ? "transactsql"
          : "mysql";
    const hasSelection = selection.from !== selection.to;
    const source = hasSelection
      ? view.state.sliceDoc(selection.from, selection.to)
      : view.state.doc.toString();

    try {
      const formatted = formatSql(source, { language: dialect, keywordCase: "upper" });
      view.dispatch({
        changes: hasSelection
          ? { from: selection.from, to: selection.to, insert: formatted }
          : { from: 0, to: view.state.doc.length, insert: formatted },
      });
    } catch (err) {
      toast.error(`No se pudo formatear: ${String(err)}`);
    }
  }, []);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => handleFormatSql();
    el.addEventListener(FORMAT_SQL_EVENT, listener);
    return () => el.removeEventListener(FORMAT_SQL_EVENT, listener);
  }, [handleFormatSql, console_.id]);

  const explainingRef = React.useRef(false);

  const handleExplain = React.useCallback(async () => {
    if (explainingRef.current) return;
    if (!sessionRef.current && !bindingRef.current) return;
    explainingRef.current = true;
    // R91: EXPLAIN también abre la conexión dormida.
    let session: Session | null;
    try {
      session = await ensureSession();
    } catch (err) {
      explainingRef.current = false;
      toast.error(`No se pudo conectar: ${String(err)}`);
      return;
    }
    if (!session) {
      explainingRef.current = false;
      return;
    }

    const view = cmRef.current?.view;
    const fullText = view ? view.state.doc.toString() : sqlRef.current;
    const selection = view?.state.selection.main;

    let sqlText: string | null = null;
    if (selection && selection.from !== selection.to) {
      sqlText = fullText.slice(selection.from, selection.to).trim();
    } else if (view) {
      sqlText = getActiveStatement(fullText, selection?.head ?? 0);
    } else {
      sqlText = splitStatements(fullText)[0] ?? null;
    }

    if (!sqlText) {
      toast.info("Coloca el cursor en una query para explicarla");
      explainingRef.current = false;
      return;
    }

    explainingRef.current = true;
    try {
      const tree = await apiExplainQuery(session.sessionId, sqlText);
      const tab = {
        id: `explain-${Date.now().toString(36)}`,
        title: "EXPLAIN",
        sql: sqlText,
        result: { columns: [], rows: [], rowCount: 0, durationMs: 0, limitApplied: false, effectiveLimit: 0 },
        tableContext: null,
        explainTree: tree,
      };
      dispatch({ type: "ADD_RESULT_TAB", payload: tab });
      dispatch({ type: "SET_ACTIVE_TAB", payload: "sql" });
    } catch (err) {
      toast.error(`No se pudo obtener el plan: ${String(err)}`);
    } finally {
      explainingRef.current = false;
    }
  }, [dispatch, ensureSession]);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => void handleExplain();
    el.addEventListener(EXPLAIN_QUERY_EVENT, listener);
    return () => el.removeEventListener(EXPLAIN_QUERY_EVENT, listener);
  }, [handleExplain, console_.id]);

  // --- IA helpers ----------------------------------------------------------

  function getEditorActiveStatement(): string | null {
    const view = cmRef.current?.view;
    const fullText = view ? view.state.doc.toString() : sqlRef.current;
    const selection = view?.state.selection.main;
    if (selection && selection.from !== selection.to) {
      return fullText.slice(selection.from, selection.to).trim();
    }
    if (view) {
      return getActiveStatement(fullText, selection?.head ?? 0);
    }
    return splitStatements(fullText)[0] ?? null;
  }

  function extractPromptFromComment(sqlText: string): string | undefined {
    const lineComment = /^\s*--\s*(.+)$/m.exec(sqlText.split(/\n/, 1)[0] ?? "");
    const blockComment = /^\s*\/\*\s*(.+?)\s*\*\//.exec(sqlText);
    return (lineComment?.[1] ?? blockComment?.[1])?.trim();
  }

  const handleOpenAiSql = React.useCallback(() => {
    const statement = getEditorActiveStatement() ?? "";
    const fromComment = extractPromptFromComment(statement);
    setAiInitialPrompt(fromComment ?? "");
    setAiDialogOpen(true);
  }, []);

  const handleInsertAiSql = React.useCallback((sql: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: sql },
    });
    view.focus();
  }, []);

  const handleReplaceAiSql = React.useCallback((sql: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const fullText = view.state.doc.toString();
    const selection = view.state.selection.main;
    const pos = selection.head;
    const active = getActiveStatementBounds(fullText, pos);
    if (!active || active.from === active.to) {
      const { from, to } = selection;
      view.dispatch({
        changes: { from, to, insert: sql },
      });
      view.focus();
      return;
    }
    view.dispatch({
      changes: { from: active.from, to: active.to, insert: sql },
    });
    view.focus();
  }, []);

  React.useEffect(() => {
    const el = cmRef.current?.editor;
    if (!el) return;
    const listener = () => handleOpenAiSql();
    el.addEventListener(AI_SQL_EVENT, listener);
    return () => el.removeEventListener(AI_SQL_EVENT, listener);
  }, [handleOpenAiSql, console_.id]);

  // Eventos a nivel ventana disparados desde la paleta de comandos.
  React.useEffect(() => {
    function onOpenAiSql() {
      handleOpenAiSql();
    }
    function onOpenAiSettings() {
      // Los ajustes de IA ahora viven dentro del panel de chat.
      showToolWindow("ai");
      window.dispatchEvent(new CustomEvent("gestordb:ai-open-settings-dialog"));
    }
    function onInsertSql(e: Event) {
      const sql = (e as CustomEvent<string>).detail;
      if (typeof sql === "string" && sql.trim()) {
        handleInsertAiSql(sql);
      }
    }
    function onReplaceSql(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.trim()) {
        handleReplaceAiSql(detail);
      }
    }
    function onOpenConvert(e: Event) {
      const sql = getEditorActiveStatement() ?? "";
      if (!sql.trim()) {
        toast.info("No hay un statement activo para convertir");
        return;
      }
      const customTarget = (e as CustomEvent<"postgres" | "mysql" | "sqlserver" | undefined>).detail;
      const currentDialect = dialectoSql(session?.type);
      const defaultTarget = currentDialect === "postgres" ? "mysql" : "postgres";
      const target = customTarget && customTarget !== currentDialect ? customTarget : defaultTarget;
      setConvertTarget({ target, sql });
    }
    async function onExplainActive() {
      const stmt = getEditorActiveStatement() ?? "";
      if (!stmt.trim()) {
        toast.info("No hay un statement activo para explicar");
        return;
      }
      if (!session) return;
      try {
        const res = await askAi({
          sessionId: session.sessionId,
          task: "explain-sql",
          sql: stmt,
          focusTables: extractScopeTables(stmt),
        });
        dispatch({
          type: "ADD_AI_MESSAGE",
          payload: makeUserChatMessage(`Explica esta consulta:\n\n${stmt}`),
        });
        dispatch({ type: "ADD_AI_MESSAGE", payload: makeAssistantChatMessage(res.text) });
        if (res.usage) dispatch({ type: "SET_AI_LAST_USAGE", payload: res.usage });
        showToolWindow("ai");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
    const onExplain = () => void onExplainActive();
    const onLintFix = () => handleLintFix();

  // Corrige el statement activo con IA usando SOLO los diagnósticos del
  // linter, antes de ejecutar nada (Task 2.2 del plan).
  function handleLintFix() {
    const sql = getEditorActiveStatement() ?? "";
    if (!sql.trim()) {
      toast.info("No hay un statement activo para corregir");
      return;
    }
    const lintErrors = buildSqlDiagnostics(sql, state.schema, session?.database)
      .filter((d) => d.severity === "error");
    if (lintErrors.length === 0) {
      toast.info("El linter no detecta errores en el statement activo");
      return;
    }
    setLintFix({
      sql,
      errorMessage: "Diagnósticos del linter (sin ejecutar):\n" +
        lintErrors.map((d) => `- ${d.message}`).join("\n"),
    });
  }

    // Fase 6 (R5, T3): hasta ahora ejecutar, cancelar, guardar, formatear y explain solo se podían
    // disparar desde DENTRO del editor (el keymap de CodeMirror emite su CustomEvent sobre
    // `view.dom`, no sobre `window`). El menú nativo vive en el proceso `main` y no puede llegar
    // ahí, así que se publican también en `window`. No se duplica nada: estos listeners llaman a
    // los MISMOS manejadores que el keymap y los botones de la barra.
    const onMenuExecute = () => void handleRun("active");
    const onMenuExecuteAll = () => void handleRun("all");
    const onMenuCancel = () => void handleCancelQuery();
    const onMenuSave = () => void handleSaveQuery();
    const onMenuFormat = () => handleFormatSql();
    const onMenuExplainPlan = () => void handleExplain();

    // Fase 70 (T2): «Corregir SQL con IA (linter)» perdió su botón al subir las acciones al
    // top bar; queda alcanzable por evento (paleta/menú), mismo patrón que los demás ai-*.
    window.addEventListener("gestordb:ai-lint-fix", onLintFix);
    window.addEventListener("gestordb:ai-sql", onOpenAiSql);
    window.addEventListener("gestordb:ai-settings", onOpenAiSettings);
    window.addEventListener("gestordb:ai-explain", onExplain);
    window.addEventListener("gestordb:ai-convert", onOpenConvert);
    window.addEventListener("gestordb:ai-insert-sql", onInsertSql);
    window.addEventListener("gestordb:ai-replace-sql", onReplaceSql);
    window.addEventListener("gestordb:execute", onMenuExecute);
    window.addEventListener("gestordb:execute-all", onMenuExecuteAll);
    window.addEventListener("gestordb:cancel-query", onMenuCancel);
    window.addEventListener("gestordb:save-query", onMenuSave);
    window.addEventListener("gestordb:format-sql", onMenuFormat);
    window.addEventListener("gestordb:explain-plan", onMenuExplainPlan);
    return () => {
      window.removeEventListener("gestordb:ai-lint-fix", onLintFix);
      window.removeEventListener("gestordb:ai-sql", onOpenAiSql);
      window.removeEventListener("gestordb:ai-settings", onOpenAiSettings);
      window.removeEventListener("gestordb:ai-explain", onExplain);
      window.removeEventListener("gestordb:ai-convert", onOpenConvert);
      window.removeEventListener("gestordb:ai-insert-sql", onInsertSql);
      window.removeEventListener("gestordb:ai-replace-sql", onReplaceSql);
      window.removeEventListener("gestordb:execute", onMenuExecute);
      window.removeEventListener("gestordb:execute-all", onMenuExecuteAll);
      window.removeEventListener("gestordb:cancel-query", onMenuCancel);
      window.removeEventListener("gestordb:save-query", onMenuSave);
      window.removeEventListener("gestordb:format-sql", onMenuFormat);
      window.removeEventListener("gestordb:explain-plan", onMenuExplainPlan);
    };
  }, [
    handleOpenAiSql,
    handleInsertAiSql,
    handleReplaceAiSql,
    session,
    dispatch,
    handleRun,
    handleCancelQuery,
    state.schema,
    handleSaveQuery,
    handleFormatSql,
    handleExplain,
  ]);

  // Fallback global por si el foco está fuera del editor.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const target = e.target as Node | null;
        const editorEl = cmRef.current?.editor;
        if (editorEl && target && editorEl.contains(target)) return;
        void handleSaveQuery();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveQuery]);

  function handleSavedFromDialog(saved: SavedQuery) {
    dispatch({
      type: "SET_ACTIVE_SAVED_QUERY",
      payload: { id: saved.id, sql: saved.sql, name: saved.name },
    });
    dispatch({ type: "UPSERT_SAVED_QUERY", payload: saved });
  }

  const isDirty = console_.activeSavedQueryId !== null && console_.sql !== console_.savedQuerySnapshot;

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!state.queryError) {
      setErrorContext(null);
      return;
    }
    const sql = getEditorActiveStatement() ?? "";
    // Enriquece el fix con los diagnósticos del linter (columnas/tablas
    // inexistentes detectadas sin ejecutar nada), además del error del driver.
    let errorMessage = state.queryError;
    const lintErrors = buildSqlDiagnostics(sql, state.schema, session?.database)
      .filter((d) => d.severity === "error");
    if (lintErrors.length > 0) {
      errorMessage +=
        "\n\nDiagnósticos del linter:\n" +
        lintErrors.map((d) => `- ${d.message}`).join("\n");
    }
    setErrorContext({ sql, errorMessage, focusTables: extractScopeTables(sql) });
  }, [state.queryError, state.schema, session?.database]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Fallback global por si el foco está fuera del editor (p.ej. tras cambiar
  // de pestaña). NO debe disparar si el foco está en el composer del chat de
  // IA (ese Cmd/Ctrl+Enter le pertenece al chat, ver ai-chat-panel.tsx).
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        const editorEl = cmRef.current?.editor;
        // Si el foco está dentro del editor, dejamos que el keymap de
        // CodeMirror dispare el evento RUN_QUERY_EVENT y no repetimos aquí.
        if (editorEl && target && editorEl.contains(target)) return;
        // Si el foco está en el composer del chat de IA, es el chat quien
        // debe manejar el atajo (enviar mensaje), no la consola.
        if (target?.closest("[data-ai-chat-composer]")) return;
        e.preventDefault();
        void handleRun("active");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRun]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        Barra de conexión de ESTA consola (multi-conexión): el selector de
        perfil/DB vive aquí, a la altura de la consola con foco, en vez del
        header global. Muestra el estado "sin conectar" con su propio flujo de
        conexión cuando la consola aún no tiene sesión.
      */}
      {/*
        Barra contextual del editor SQL (estilo OpenDesign): las acciones de ejecución y formato
        viven junto al editor donde el usuario escribe sus consultas.
      */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-gdb-sep bg-gdb-chrome px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {state.running ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleCancelQuery()}
              title="Cancelar la consulta en curso"
              className="h-7 gap-1.5 px-2.5"
            >
              <IjIcon name="stop" />
              Cancelar
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleRun("active")}
              disabled={!conexion}
              title="Ejecutar sentencia actual (Cmd/Ctrl+↩)"
              className="h-7 gap-1.5 bg-primary px-2.5 text-primary-foreground hover:bg-primary/90"
            >
              <IjIcon name="run" />
              Ejecutar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleRun("all")}
            disabled={!conexion || state.running}
            title="Ejecutar todo el documento (Cmd/Ctrl+⇧+↩)"
            className="h-7 gap-1.5 border-gdb-sep bg-transparent px-2.5 text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
          >
            <IjIcon name="runAll" />
            Todo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleExplain()}
            disabled={!conexion || state.running}
            title="Ver plan de ejecución (Cmd/Ctrl+⇧+J)"
            className="h-7 gap-1.5 border-gdb-sep bg-transparent px-2.5 text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
          >
            <IjIcon name="explainPlan" />
            EXPLAIN
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleFormatSql}
            title="Formatear consulta (Cmd/Ctrl+⇧+F)"
            className="h-7 gap-1.5 border-gdb-sep bg-transparent px-2.5 text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
          >
            <IjIcon name="reformatCode" />
            Formatear
          </Button>
          <div className="flex items-center gap-1.5">
            {(() => {
              const txActiva = state.transactionActive || txMode === "manual";
              return (
                <>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={txActiva}
                    disabled={!session}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent(txActiva ? "gestordb:tx-auto" : "gestordb:tx-manual")
                      )
                    }
                    title={
                      state.transactionActive
                        ? "Transacción activa (manual) — haz Commit o Rollback para finalizar"
                        : "Activar modo transacción manual (BEGIN)"
                    }
                    className={cn(
                      "inline-flex h-7 items-center gap-2 rounded-md border px-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-45",
                      state.transactionActive
                        ? "border-gdb-warn/60 bg-gdb-warnbg text-gdb-warnfg"
                        : "border-gdb-sep bg-transparent text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full border transition-colors",
                        state.transactionActive
                          ? "border-gdb-warn bg-gdb-warn"
                          : "border-gdb-borderstrong bg-gdb-contrast"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-2.5 rounded-full bg-gdb-onaccent shadow-xs transition-transform",
                          txActiva ? "translate-x-2.5" : "translate-x-0.5"
                        )}
                      />
                    </span>
                    <span className="font-medium">Tx</span>
                    <span className="flex items-center gap-1 text-[11px]">
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          state.transactionActive ? "bg-gdb-warn" : "bg-gdb-live"
                        )}
                      />
                      {state.transactionActive ? "Activa" : "Auto"}
                    </span>
                  </button>

                  {state.transactionActive && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.dispatchEvent(new CustomEvent("gestordb:commit"))}
                        disabled={!session || state.running}
                        title="Confirmar transacción (COMMIT)"
                        className="h-7 gap-1 border-gdb-okfg/40 bg-gdb-okbg px-2 text-gdb-okfg hover:bg-gdb-okbg/80"
                      >
                        <IjIcon name="commit" />
                        Commit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.dispatchEvent(new CustomEvent("gestordb:rollback"))}
                        disabled={!session || state.running}
                        title="Revertir transacción (ROLLBACK)"
                        className="h-7 gap-1 border-gdb-dangerborder bg-gdb-dangerbg px-2 text-gdb-dangerfg hover:bg-gdb-dangerbg/80"
                      >
                        <IjIcon name="revert" />
                        Rollback
                      </Button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {console_.activeSavedQueryId && (
            <div className="mr-1 flex items-center gap-1.5 text-xs text-gdb-fgdim">
              <span className="max-w-[200px] truncate text-gdb-fg">
                {state.savedQueries.find((q) => q.id === console_.activeSavedQueryId)
                  ?.name ?? "Consulta guardada"}
              </span>
              {isDirty && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-gdb-warn"
                  title="Cambios sin guardar (Cmd/Ctrl+S para guardar)"
                />
              )}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleSaveQuery()}
            title="Guardar consulta (Cmd/Ctrl+S)"
            className="h-7 gap-1.5 border-gdb-sep bg-transparent px-2.5 text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
          >
            <IjIcon name="save" />
            Guardar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenAiSql}
            disabled={session === null || state.aiSettings?.enabled === false}
            title="Asistente IA: Generar SQL… (Cmd/Ctrl+⇧+Y)"
            className="h-7 gap-1.5 border-gdb-sep bg-transparent px-2.5 text-gdb-fg hover:bg-gdb-hover hover:text-gdb-fgstrong"
          >
            <IjIcon name="ai" />
            IA SQL
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
      {/*
        El contenedor del editor es `flex-1 min-h-0`: ocupa TODO el alto que le deja el panel y se
        encoge al arrastrar el separador de resultados o al minimizarlos. Antes llevaba
        `min-h-[200px]` y la columna tenía `overflow-y-auto`, así que el editor crecía con el texto
        y el panel grande quedaba vacío (el scroll lo tenía la columna, no el editor).
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gdb-editor">
        <OwnEditor
            key={`own-${console_.id}`}
            ref={ownRef}
            value={console_.sql}
            onChange={(value) => dispatch({ type: "SET_SQL", payload: value })}
            minHeight="0"
            className="h-full min-h-0 text-sm font-jetbrains"
            dialecto={(console_.session ?? console_.binding)?.type === "mysql" ? "mysql" : (console_.session ?? console_.binding)?.type === "postgres" ? "postgres" : "standard"}
            suggest={suggestContextual}
            nombres={nombresDeEsquema}
            currentStatement={getStatementRangeAt}
            diagnostics={diagnosticos}
            onAction={(accion) => adaptador?.onAction(accion)}
            onElement={(elemento) => {
              elementRef.current = elemento;
            }}
          />
      </div>
      {state.queryError && (
        <div className="grid gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          <div>{state.queryError}</div>
          {session && state.aiSettings?.enabled !== false && errorContext && (
            <AiFixPreview
              sql={errorContext.sql}
              errorMessage={errorContext.errorMessage}
              focusTables={errorContext.focusTables}
              onInsert={handleInsertAiSql}
              onReplace={handleReplaceAiSql}
              onDismiss={() => dispatch({ type: "SET_QUERY_ERROR", payload: null })}
            />
          )}
        </div>
      )}
      {lintFix && (
        <AiFixPreview
          sql={lintFix.sql}
          errorMessage={lintFix.errorMessage}
          focusTables={extractScopeTables(lintFix.sql)}
          onInsert={handleInsertAiSql}
          onReplace={(sql) => {
            handleReplaceAiSql(sql);
            setLintFix(null);
          }}
          onDismiss={() => setLintFix(null)}
        />
      )}
      <AiSqlDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        initialPrompt={aiInitialPrompt}
        onInsert={handleInsertAiSql}
        onReplace={handleReplaceAiSql}
      />
      {convertTarget && (
        <AiConvertDialog
          open
          onOpenChange={(open) => {
            if (!open) setConvertTarget(null);
          }}
          sql={convertTarget.sql}
          targetDialect={convertTarget.target}
          onInsert={handleInsertAiSql}
          onReplace={handleReplaceAiSql}
        />
      )}
      <SaveQueryDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        initialSql={console_.sql}
        connectionId={connectionOf(console_)?.name ?? session?.name}
        // R96: la consulta se liga al PERFIL (renombrar la conexión ya no la deja huérfana) y
        // recuerda la base en la que estaba la consola.
        profileId={connectionOf(console_)?.profileId}
        database={connectionOf(console_)?.database}
        onSaved={handleSavedFromDialog}
      />
      <ConfirmRiskyQueryDialog
        risks={riskyStatements ?? []}
        open={riskyStatements !== null}
        onOpenChange={(open) => {
          if (!open) {
            pendingStatementsRef.current = null;
            setRiskyStatements(null);
          }
        }}
        onConfirm={() => {
          setRiskyStatements(null);
          handleConfirmRiskyRun();
        }}
      />
      </div>
    </div>
  );
}
