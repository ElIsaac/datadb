import * as React from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CodePreview } from "@/components/code-preview";
import { MarkdownContent } from "@/components/markdown-content";
import { useAppState, useAppDispatch, useActiveConsole, useActiveSession } from "@/hooks/use-app-state";
import { askAi, MISSING_KEY_MESSAGE } from "@/lib/ai";
import { extractScopeTables } from "@/lib/sql-scope";
import { detectSqlRisk } from "@/lib/sql-safety";
import { isReadOnlyStatement } from "@/server/db/read-only-guard";
import { getActiveStatement } from "@/lib/sql-statements";
import type { AiResponse } from "@/lib/ai-types";
import { SparklesIcon, CopyIcon, CheckIcon, Wand2Icon, XIcon, AlertTriangleIcon } from "lucide-react";

export interface AiSqlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt?: string;
  onInsert: (sql: string) => void;
  onReplace: (sql: string) => void;
}

export function AiSqlDialog({
  open,
  onOpenChange,
  initialPrompt = "",
  onInsert,
  onReplace,
}: AiSqlDialogProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const console_ = useActiveConsole();
  const session = useActiveSession();

  const [prompt, setPrompt] = React.useState(initialPrompt);
  const [busy, setBusy] = React.useState(false);
  const [response, setResponse] = React.useState<AiResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setResponse(null);
    }
  }, [open, initialPrompt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeStatement = React.useMemo(() => {
    return getActiveStatement(console_.sql, console_.sql.length);
  }, [console_.sql]);

  const focusTables = React.useMemo(() => {
    return extractScopeTables(activeStatement);
  }, [activeStatement]);

  async function handleSubmit() {
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
        task: "text-to-sql",
        prompt,
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

  const sqlToShow = response?.sql ?? response?.text ?? "";
  const risks = response?.sql ? (detectSqlRisk(response.sql) ? [detectSqlRisk(response.sql)!] : []) : [];

  const readOnlyBlock =
    session?.readOnly && response?.sql ? !isReadOnlyStatement(response.sql, session.type) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" />
            Generar SQL con IA
          </DialogTitle>
          <DialogDescription>
            Describe lo que necesitas y la IA generará SQL usando el esquema activo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Contexto:</span>
            {focusTables.length === 0 ? (
              <span className="text-xs text-muted-foreground">Todas las tablas</span>
            ) : (
              focusTables.map((t) => (
                <Badge key={`${t.schema ?? "public"}.${t.table}`} variant="secondary" className="text-[10px]">
                  {t.schema ? `${t.schema}.` : ""}{t.table}
                </Badge>
              ))
            )}
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ej: los 10 clientes con mayor facturación del último mes"
            rows={3}
            disabled={busy}
          />

          {response && (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Resultado</span>
                <span className="text-[10px] text-muted-foreground">{response.model}</span>
              </div>
              {sqlToShow ? (
                <div className="h-48 overflow-hidden rounded border">
                  <CodePreview value={sqlToShow} language="sql" className="h-full" fontSize="13px" />
                </div>
              ) : (
                <MarkdownContent content={response.text} className="text-muted-foreground" />
              )}
              {risks.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-gdb-warn/20 bg-gdb-warn/10 p-2 text-xs text-gdb-warnfg">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Advertencia de seguridad:</p>
                    <p>{risks[0].message}</p>
                  </div>
                </div>
              )}
              {readOnlyBlock && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Conexión en modo solo lectura</p>
                    <p>No se permite ejecutar sentencias que no sean SELECT/WITH/SHOW/EXPLAIN.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {response?.sql ? (
            <>
              <Button variant="outline" size="sm" onClick={copySql}>
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                Copiar
              </Button>
              <Button variant="outline" size="sm" onClick={() => response.sql && onInsert(response.sql)}>
                Insertar en cursor
              </Button>
              <Button size="sm" onClick={() => response.sql && onReplace(response.sql)} disabled={readOnlyBlock}>
                <Wand2Icon className="size-3.5" />
                Reemplazar statement
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setResponse(null)}>
                <XIcon className="size-3.5" />
                Nueva petición
              </Button>
            </>
          ) : (
            <Button onClick={handleSubmit} disabled={busy || !prompt.trim()}>
              {busy ? "Generando…" : "Generar SQL"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
