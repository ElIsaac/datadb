import * as React from "react";
import { dialectoSql } from "@/shared/connection-net";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodePreview } from "@/components/code-preview";
import { MarkdownContent } from "@/components/markdown-content";
import { useAppState, useAppDispatch, useActiveSession } from "@/hooks/use-app-state";
import { askAi, MISSING_KEY_MESSAGE } from "@/lib/ai";
import { extractScopeTables } from "@/lib/sql-scope";
import { detectSqlRisk } from "@/lib/sql-safety";
import { isReadOnlyStatement } from "@/server/db/read-only-guard";
import type { AiResponse } from "@/lib/ai-types";
import { CheckIcon, CopyIcon, LanguagesIcon, XIcon, AlertTriangleIcon } from "lucide-react";

export interface AiConvertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** SQL fuente a convertir (statement activo). */
  sql: string;
  /** Dialecto destino. */
  targetDialect: "postgres" | "mysql" | "sqlserver";
  onInsert?: (sql: string) => void;
  onReplace: (sql: string) => void;
}

/**
 * Convierte el statement activo a otro dialecto (Postgres / MySQL / SQL Server) usando IA.
 * Muestra el resultado en preview; nunca ejecuta — solo inserta o reemplaza en el editor.
 */
export function AiConvertDialog({
  open,
  onOpenChange,
  sql,
  targetDialect,
  onInsert,
  onReplace,
}: AiConvertDialogProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // Las acciones de IA operan sobre la conexión de la consola con foco.
  const session = useActiveSession();
  const [selectedTarget, setSelectedTarget] = React.useState<"postgres" | "mysql" | "sqlserver">(
    targetDialect
  );
  const [busy, setBusy] = React.useState(false);
  const [response, setResponse] = React.useState<AiResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setSelectedTarget(targetDialect);
  }, [open, targetDialect]);

  React.useEffect(() => {
    if (!open) {
      setResponse(null);
      setBusy(false);
      dispatch({ type: "SET_AI_BUSY", payload: false });
      return;
    }
    if (!session) return;
    if (!state.aiSettings?.hasApiKey) {
      toast.error(MISSING_KEY_MESSAGE);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setResponse(null);
    dispatch({ type: "SET_AI_BUSY", payload: true });
    askAi({
      sessionId: session.sessionId,
      task: "convert-sql",
      sql,
      targetDialect: selectedTarget,
      focusTables: extractScopeTables(sql),
    })
      .then((res) => {
        if (cancelled) return;
        setResponse(res);
        if (res.usage) dispatch({ type: "SET_AI_LAST_USAGE", payload: res.usage });
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setBusy(false);
        dispatch({ type: "SET_AI_BUSY", payload: false });
      });
    return () => {
      cancelled = true;
    };
  }, [open, sql, selectedTarget, session, state.aiSettings?.hasApiKey, dispatch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const convertedSql = response?.sql ?? "";
  const risk = convertedSql ? detectSqlRisk(convertedSql) : null;
  const readOnlyBlock =
    session?.readOnly && convertedSql ? !isReadOnlyStatement(convertedSql, session.type) : false;

  async function copySql() {
    if (!convertedSql) return;
    await navigator.clipboard.writeText(convertedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function dialectLabel(type: "postgres" | "mysql" | "sqlserver"): string {
    if (type === "postgres") return "PostgreSQL";
    if (type === "sqlserver") return "SQL Server";
    return "MySQL";
  }
  const sourceDialect = dialectoSql(session?.type);
  const availableTargets = (["postgres", "mysql", "sqlserver"] as const).filter(
    (d) => d !== sourceDialect
  );
  const targetLabel = dialectLabel(selectedTarget);
  const sourceLabel = dialectLabel(sourceDialect);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LanguagesIcon className="size-4 text-primary" />
            Convertir a {targetLabel}
          </DialogTitle>
          <DialogDescription>
            De {sourceLabel} a {targetLabel}. El resultado se previsualiza; nunca se ejecuta solo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Dialecto destino:</span>
            {availableTargets.map((d) => (
              <Button
                key={d}
                type="button"
                size="xs"
                variant={selectedTarget === d ? "default" : "outline"}
                onClick={() => setSelectedTarget(d)}
              >
                {dialectLabel(d)}
              </Button>
            ))}
          </div>

          <div className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Original ({sourceLabel})</span>
            <div className="h-28 overflow-hidden rounded border">
              <CodePreview value={sql} language="sql" className="h-full" fontSize="13px" />
            </div>
          </div>

          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Convertido ({targetLabel})
              </span>
              {response && (
                <Badge variant="secondary" className="text-[10px]">{response.model}</Badge>
              )}
            </div>
            {busy ? (
              <div className="flex h-28 items-center justify-center rounded border text-xs text-muted-foreground">
                <span className="animate-pulse">Convirtiendo…</span>
              </div>
            ) : convertedSql ? (
              <div className="h-40 overflow-hidden rounded border">
                <CodePreview value={convertedSql} language="sql" className="h-full" fontSize="13px" />
              </div>
            ) : (
              <div className="flex h-28 items-center justify-center rounded border text-xs text-muted-foreground">
                Sin resultado
              </div>
            )}
          </div>

          {risk && (
            <div className="flex items-start gap-2 rounded-md border border-gdb-warn/20 bg-gdb-warn/10 p-2 text-xs text-gdb-warnfg">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p className="font-medium">Advertencia de seguridad:</p>
                <p>{risk.message}</p>
              </div>
            </div>
          )}
          {readOnlyBlock && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <p>Conexión en modo solo lectura: esta sentencia no se puede reemplazar.</p>
            </div>
          )}
          {response && !response.sql && (
            <MarkdownContent content={response.text} className="text-muted-foreground" />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <XIcon className="size-3.5" />
            Cerrar
          </Button>
          {convertedSql && (
            <>
              <Button variant="outline" size="sm" onClick={copySql}>
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                Copiar
              </Button>
              {onInsert && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onInsert(convertedSql);
                    onOpenChange(false);
                  }}
                >
                  Insertar en cursor
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  onReplace(convertedSql);
                  onOpenChange(false);
                }}
                disabled={readOnlyBlock}
              >
                Reemplazar statement
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
