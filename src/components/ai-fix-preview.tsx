import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodePreview } from "@/components/code-preview";
import { useAppState, useAppDispatch, useActiveSession } from "@/hooks/use-app-state";
import { askAi, MISSING_KEY_MESSAGE } from "@/lib/ai";
import { detectSqlRisk } from "@/lib/sql-safety";
import { isReadOnlyStatement } from "@/server/db/read-only-guard";
import type { AiResponse } from "@/lib/ai-types";
import { CheckIcon, CopyIcon, Wand2Icon, XIcon, AlertTriangleIcon } from "lucide-react";

export interface AiFixPreviewProps {
  sql: string;
  errorMessage: string;
  focusTables: { schema?: string; table: string }[];
  onInsert: (sql: string) => void;
  onReplace: (sql: string) => void;
  onDismiss: () => void;
}

export function AiFixPreview({
  sql,
  errorMessage,
  focusTables,
  onInsert,
  onReplace,
  onDismiss,
}: AiFixPreviewProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const session = useActiveSession();
  const [busy, setBusy] = React.useState(false);
  const [response, setResponse] = React.useState<AiResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  const risk = response?.sql ? detectSqlRisk(response.sql) : null;
  const readOnlyBlock = session?.readOnly && response?.sql ? !isReadOnlyStatement(response.sql, session.type) : false;

  async function handleFix() {
    if (!session) {
      toast.error("No hay una sesión activa");
      return;
    }
    if (!state.aiSettings?.hasApiKey) {
      toast.error(MISSING_KEY_MESSAGE);
      return;
    }
    setBusy(true);
    dispatch({ type: "SET_AI_BUSY", payload: true });
    try {
      const res = await askAi({
        sessionId: session.sessionId,
        task: "fix-sql",
        sql,
        errorMessage,
        focusTables,
      });
      setResponse(res);
      if (res.usage) {
        dispatch({ type: "SET_AI_LAST_USAGE", payload: res.usage });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      dispatch({ type: "SET_AI_BUSY", payload: false });
    }
  }

  async function copySql() {
    if (!response?.sql) return;
    await navigator.clipboard.writeText(response.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (response?.sql) {
    return (
      <div className="rounded-md border border-gdb-warn/30 bg-gdb-warn/10 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">SQL corregido por IA</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-xs" onClick={copySql}>
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={onDismiss}>
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="h-40 overflow-hidden rounded border bg-background">
          <CodePreview value={response.sql} language="sql" className="h-full" fontSize="13px" />
        </div>
        {risk && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-gdb-warn/20 bg-gdb-warn/10 p-2 text-xs text-gdb-warnfg">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-medium">Advertencia:</p>
              <p>{risk.message}</p>
            </div>
          </div>
        )}
        {readOnlyBlock && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-medium">Solo lectura</p>
              <p>No se permite ejecutar esta sentencia en una conexión de solo lectura.</p>
            </div>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onInsert(response.sql!)}>
            Insertar
          </Button>
          <Button size="sm" onClick={() => onReplace(response.sql!)} disabled={readOnlyBlock}>
            <Wand2Icon className="mr-1 size-3.5" />
            Reemplazar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-gdb-warn/30 bg-gdb-warn/10 px-3 py-2">
      <span className="text-sm">¿Quieres que la IA intente corregir el error?</span>
      <Button size="sm" variant="outline" onClick={handleFix} disabled={busy}>
        {busy ? "Corrigiendo…" : "Corregir con IA"}
      </Button>
    </div>
  );
}
