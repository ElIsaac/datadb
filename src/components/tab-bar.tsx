import * as React from "react";
import { IjIcon } from "@/components/ij-icon";
import { useAppState, useAppDispatch } from "@/hooks/use-app-state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TabBar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  function handleCloseTab(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    dispatch({ type: "CLOSE_TABLE_TAB", payload: id });
  }

  function handleSelectConsole(id: string) {
    dispatch({ type: "SET_ACTIVE_CONSOLE", payload: id });
  }

  function handleCloseConsole(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    dispatch({ type: "CLOSE_CONSOLE", payload: id });
  }

  function handleNewConsole() {
    dispatch({ type: "NEW_CONSOLE", payload: { id: crypto.randomUUID() } });
  }

  function startRename(e: React.MouseEvent, id: string, currentName: string) {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentName);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      dispatch({
        type: "RENAME_CONSOLE",
        payload: { id: renamingId, name: renameValue.trim() },
      });
    }
    setRenamingId(null);
  }

  const isSqlActive = state.activeTabId === "sql";

  return (
    <div className="flex h-[var(--gdb-tab-h)] shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-gdb-sep bg-gdb-tabsbg px-2 scrollbar-thin">
      {state.consoles.map((console_) => {
        const isCurrentConsole = console_.id === state.activeConsoleId;
        const isViewing = isSqlActive && isCurrentConsole;
        const isRenaming = renamingId === console_.id;
        return (
          <Tooltip key={console_.id}>
            <TooltipTrigger
              className={cn(
                "group relative mt-1 flex shrink-0 max-w-[200px] items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors",
                isViewing
                  ? "border-gdb-sep bg-gdb-editor font-medium text-gdb-fgstrong"
                  : isCurrentConsole
                    ? "border-gdb-sep/50 bg-gdb-tabactive/60 font-medium text-gdb-fg hover:bg-gdb-rowhover"
                    : "border-transparent text-gdb-fgdim hover:bg-gdb-rowhover hover:text-gdb-fg"
              )}
              onClick={() => handleSelectConsole(console_.id)}
              onDoubleClick={(e) => startRename(e, console_.id, console_.name)}
            >
              {isCurrentConsole && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-gdb-accent" />
              )}
              {/*
                Punto de color de la conexión de ESTA consola (multi-conexión):
                cada consola puede estar contra un perfil distinto, así que el
                color vive por consola, no global. Gris si aún no está conectada.
              */}
              <span
                className="size-2 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                style={{ backgroundColor: (console_.session ?? console_.binding)?.color ?? "#666" }}
              />
              {/*
                F2 (2026-10-20): la pestaña de la consola lleva el icono del MOTOR al que está
                conectada (marca oficial para PostgreSQL/MySQL; cilindro en rojo para SQL Server).
                Sin sesión no hay motor que mostrar y se queda el icono de consola.
              */}
              <IjIcon
                name={
                  (console_.session ?? console_.binding)?.type === "postgres"
                    ? "postgres"
                    : (console_.session ?? console_.binding)?.type === "mysql"
                      ? "mysql"
                      : (console_.session ?? console_.binding)?.type === "sqlserver"
                        ? "database"
                        : "console"
                }
                className={cn(
                  "shrink-0",
                  (console_.session ?? console_.binding)?.type === "postgres" && "text-gdb-enginepg",
                  (console_.session ?? console_.binding)?.type === "mysql" && "text-gdb-enginemysql",
                  (console_.session ?? console_.binding)?.type === "sqlserver" && "text-gdb-enginemssql"
                )}
                label={(console_.session ?? console_.binding)?.type}
              />
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-20 bg-transparent outline-none"
                />
              ) : (
                <span className="truncate">{console_.name}</span>
              )}
              {state.consoles.length > 1 && (
                <span
                  className={cn(
                    "ml-0.5 shrink-0 opacity-0 transition-opacity",
                    isCurrentConsole ? "opacity-100" : "group-hover:opacity-100"
                  )}
                  onClick={(e) => handleCloseConsole(e, console_.id)}
                >
                  <IjIcon name="close" />
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {/*
                El tooltip incluye el nombre de la conexión de la consola cuando
                la hay (p. ej. "Consola 2 — Postgres-prod"), útil para distinguir
                varias consolas conectadas a perfiles distintos.
              */}
              {/* R91: la consola dormida también dice a qué está atada (se conecta al ejecutar). */}
              {console_.session
                ? `${console_.name} — ${console_.session.name}`
                : console_.binding
                  ? `${console_.name} — ${console_.binding.name} (se conecta al ejecutar)`
                  : `${console_.name} (sin conexión)`}{" "}
              (doble clic para renombrar)
            </TooltipContent>
          </Tooltip>
        );
      })}

      <Tooltip>
        <TooltipTrigger
          className="mx-1 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={handleNewConsole}
        >
          <IjIcon name="add" />
        </TooltipTrigger>
        <TooltipContent>Nueva consola SQL</TooltipContent>
      </Tooltip>

      {state.tableTabs.length > 0 && <div className="mx-1 h-4 w-px shrink-0 self-center bg-gdb-sep" />}

      {state.tableTabs.map((tab) => {
        const isLog = tab.kind === "sqlLog"; // fase 3 (T7)
        const fullName = isLog
          ? "Log SQL (todas las conexiones, solo lectura)"
          : tab.kind === "diagram" && tab.scopeTables && tab.scopeTables.length > 0
            ? tab.scopeTables.map((t) => `${t.schema}.${t.table}`).join(", ")
            : tab.id;
        const shortName = isLog
          ? "Log SQL"
          : tab.kind === "diagram" && tab.scopeTables && tab.scopeTables.length > 0
            ? "Consulta"
            : tab.target.table;
        const isActive = state.activeTabId === tab.id;
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger
              className={cn(
                "group relative mt-1 flex shrink-0 max-w-[200px] items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors",
                isActive
                  ? "border-gdb-sep bg-gdb-editor font-medium text-gdb-fgstrong after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-gdb-accent"
                  : "border-transparent text-gdb-fgdim hover:bg-gdb-rowhover hover:text-gdb-fg"
              )}
              onClick={() => dispatch({ type: "SET_ACTIVE_TAB", payload: tab.id })}
            >
              <IjIcon name={isLog ? "history" : tab.kind === "diagram" ? "diagram" : "table"} />
              <span className="truncate">{shortName}</span>
              <span
                className={cn(
                  "ml-0.5 opacity-0 transition-opacity",
                  isActive ? "opacity-100" : "group-hover:opacity-100"
                )}
                onClick={(e) => handleCloseTab(e, tab.id)}
              >
                <IjIcon name="close" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{fullName}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
