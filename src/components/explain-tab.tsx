import * as React from "react";
import { toast } from "sonner";
import type { ExplainNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppState, useAppDispatch, useActiveSession } from "@/hooks/use-app-state";
import { showToolWindow } from "@/shell/layout-store";
import { askAi, makeUserChatMessage, makeAssistantChatMessage, MISSING_KEY_MESSAGE } from "@/lib/ai";
import { extractScopeTables } from "@/lib/sql-scope";
import { ChevronDownIcon, ChevronRightIcon, AlertTriangleIcon, SparklesIcon } from "lucide-react";

interface ExplainTabProps {
  tree: ExplainNode;
  /** SQL del que se generó este plan; habilita "Optimizar con IA". */
  sql?: string;
}

/**
 * Árbol colapsable del plan de ejecución (EXPLAIN), normalizado desde
 * Postgres (EXPLAIN FORMAT JSON) o MySQL (EXPLAIN FORMAT=JSON) en el
 * servidor. Los nodos marcados `expensive` (full scan sin índice, costo
 * alto) se resaltan en rojo, como hace DataGrip.
 */
export function ExplainTab({ tree, sql }: ExplainTabProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // EXPLAIN "Optimizar con IA" opera contra la sesión de la consola con foco.
  const session = useActiveSession();
  const [busy, setBusy] = React.useState(false);

  async function handleOptimize() {
    if (!session || !sql) return;
    if (!state.aiSettings?.hasApiKey) {
      toast.error(MISSING_KEY_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const res = await askAi({
        sessionId: session.sessionId,
        task: "optimize-sql",
        sql,
        explainPlan: JSON.stringify(tree, null, 2),
        focusTables: extractScopeTables(sql),
      });
      dispatch({
        type: "ADD_AI_MESSAGE",
        payload: makeUserChatMessage(`Optimiza esta consulta:\n\n${sql}`),
      });
      dispatch({
        type: "ADD_AI_MESSAGE",
        payload: makeAssistantChatMessage(res.text),
      });
      if (res.usage) dispatch({ type: "SET_AI_LAST_USAGE", payload: res.usage });
      showToolWindow("ai");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-background px-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Plan de ejecución</span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-destructive/70" />
          nodo potencialmente costoso
        </span>
        {sql && state.aiSettings?.enabled !== false && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            onClick={() => void handleOptimize()}
            disabled={busy || !session}
            title="Enviar el plan EXPLAIN real al modelo para sugerencias de optimización"
          >
            <SparklesIcon className="size-3" />
            {busy ? "Analizando…" : "Optimizar con IA"}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ExplainNodeRow node={tree} depth={0} />
      </div>
    </div>
  );
}

function ExplainNodeRow({ node, depth }: { node: ExplainNode; depth: number }) {
  const [open, setOpen] = React.useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-xs hover:bg-muted/60",
          node.expensive && "bg-destructive/10"
        )}
        style={{ paddingLeft: depth * 18 + 6 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </button>
        ) : (
          <span className="inline-block size-3 shrink-0" />
        )}

        {node.expensive && (
          <AlertTriangleIcon className="size-3 shrink-0 text-destructive" />
        )}

        <span
          className={cn(
            "font-semibold",
            node.expensive ? "text-destructive" : "text-foreground"
          )}
        >
          {node.type}
        </span>

        {node.detail && (
          <span className="truncate text-muted-foreground">{node.detail}</span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-[10px] text-muted-foreground">
          {node.cost !== undefined && <span>costo {node.cost.toFixed(2)}</span>}
          {node.rows !== undefined && <span>~{node.rows} filas</span>}
        </span>
      </div>

      {open && hasChildren && (
        <div>
          {node.children.map((child, idx) => (
            <ExplainNodeRow key={idx} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
