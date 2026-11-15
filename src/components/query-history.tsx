import * as React from "react";
import { IjIcon } from "@/components/ij-icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppState, useAppDispatch, useActiveSession } from "@/hooks/use-app-state";
import { clearQueryHistory, listQueryHistory } from "@/lib/api";
import { cn } from "@/lib/utils";


function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function QueryHistoryContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // El historial es por-sesión: usamos la conexión de la consola con foco.
  const session = useActiveSession();
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return state.queryHistory;
    return state.queryHistory.filter((entry) =>
      entry.sql.toLowerCase().includes(term)
    );
  }, [state.queryHistory, search]);

  async function reloadHistory() {
    if (!session) return;
    try {
      const history = await listQueryHistory(session.sessionId);
      dispatch({ type: "SET_QUERY_HISTORY", payload: history });
    } catch (err) {
      toast.error(String(err));
    }
  }

  React.useEffect(() => {
    if (!session || state.queryHistory.length > 0) return;
    reloadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state.queryHistory.length]);

  function handleLoad(sql: string) {
    dispatch({ type: "SET_SQL", payload: sql });
    dispatch({ type: "SET_ACTIVE_TAB", payload: "sql" });
    toast.info("Consulta cargada en el editor");
  }

  async function handleClear() {
    if (!session) return;
    try {
      await clearQueryHistory(session.sessionId);
      dispatch({ type: "CLEAR_QUERY_HISTORY" });
      toast.success("Historial limpiado");
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border/60 p-3">
        <div className="relative">
          <IjIcon name="search" className="absolute top-1/2 left-2.5 -translate-y-1/2" />
          <Input
            placeholder="Buscar consulta..."
            className="h-7 border-border/60 bg-gdb-field pl-8 text-xs placeholder:text-muted-foreground focus-visible:border-ring"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            className="flex-1 border-border/60 bg-transparent text-xs text-foreground hover:bg-gdb-hover"
            onClick={reloadHistory}
          >
            <IjIcon name="history" />
            Recargar
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="flex-1 border-border/60 bg-transparent text-xs text-foreground hover:bg-gdb-hover"
            onClick={handleClear}
            disabled={state.queryHistory.length === 0}
          >
            <IjIcon name="delete" />
            Limpiar
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-border/60 bg-transparent text-foreground hover:bg-gdb-hover"
            // Fase 3 (T7, D3): antes `window.open("/api/query/log")`, que en Electron abría el HTML de Vite.
            onClick={() => dispatch({ type: "OPEN_SQL_LOG_TAB" })}
            title="Ver el log SQL completo (todas las conexiones) en una pestaña de solo lectura"
            data-testid="open-sql-log"
          >
            <IjIcon name="history" />
            Log SQL
          </Button>
        </div>
      </div>

      <ScrollArea className="h-full flex-1">
        <div className="p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {search
                ? "No se encontraron consultas"
                : "Aún no hay consultas ejecutadas"}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((entry) => {
                const engine = entry.engine ?? session?.type;
                const database = entry.database ?? session?.database;
                const engineIcon =
                  engine === "postgres"
                    ? "postgres"
                    : engine === "mysql"
                      ? "mysql"
                      : engine === "mongodb"
                        ? "mongodb"
                        : "database";
                const engineColor =
                  engine === "postgres"
                    ? "text-gdb-enginepg"
                    : engine === "mysql"
                      ? "text-gdb-enginemysql"
                      : engine === "mongodb"
                        ? "text-gdb-enginemongo"
                        : engine === "sqlserver"
                          ? "text-gdb-enginemssql"
                          : "text-gdb-fgmuted";

                return (
                <li
                  key={entry.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:bg-gdb-hover",
                    entry.error && "bg-destructive/5 hover:bg-destructive/10"
                  )}
                >
                  {entry.error ? (
                    <IjIcon name="error" className="shrink-0" />
                  ) : (
                    <IjIcon name="success" className="shrink-0" />
                  )}

                  <button
                    className="flex min-w-0 flex-1 flex-col text-left"
                    onClick={() => handleLoad(entry.sql)}
                    title={entry.sql}
                  >
                    <span className="truncate text-xs font-medium font-jetbrains text-foreground">
                      {entry.sql}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
                      {(engine || database) && (
                        <span className="flex items-center gap-1 rounded border border-gdb-sep/70 bg-gdb-chrome/60 px-1 py-[0.5px] font-jetbrains text-[9.5px] text-gdb-fg">
                          <IjIcon name={engineIcon} className={cn("size-3 shrink-0", engineColor)} />
                          {database && <span className="max-w-[90px] truncate">{database}</span>}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <IjIcon name="history" />
                        {formatTime(entry.executedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <IjIcon name="stopWatch" />
                        {formatDuration(entry.durationMs)}
                      </span>
                      {entry.rowCount !== undefined && (
                        <span className="flex items-center gap-1">
                          <IjIcon name="table" />
                          {entry.rowCount} filas
                        </span>
                      )}
                      {entry.affectedRows !== undefined && (
                        <span className="flex items-center gap-1">
                          <IjIcon name="table" />
                          {entry.affectedRows} afectadas
                        </span>
                      )}
                      {entry.error && (
                        <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          ERROR
                        </span>
                      )}
                    </span>
                  </button>

                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => handleLoad(entry.sql)}
                    title="Cargar en editor"
                  >
                    <IjIcon name="run" />
                  </Button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

