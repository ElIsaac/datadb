/**
 * Pestaña «Log SQL» (fase 3, T7; decisión D3 del usuario: dentro de la app, de solo lectura).
 *
 * Replica «Help | Show SQL Log» de DataGrip, que abre el log en un editor de solo lectura. Muestra el FINAL de
 * `data/sql-log.jsonl` (hasta 1 MB): el archivo es append-only y no tiene límite de tamaño, así que leerlo entero
 * podría congelar la pestaña. La cabecera dice el tamaño total y si se está viendo solo el final. «Recargar» vuelve a
 * leer (el log crece con cada query de cualquier conexión).
 *
 * Antes era un enlace `window.open("/api/query/log")` que en Electron abría el HTML de Vite (la ruta de Next no
 * existe en la app de escritorio).
 *
 * Huecos conocidos: no hay filtro por conexión ni búsqueda propia (la de CodeMirror sí funciona con Cmd+F), ni se
 * puede rotar o borrar el log desde aquí (fuera de alcance de la fase 3).
 */
import * as React from "react";
import { CodePreview } from "@/components/code-preview";
import { IjIcon } from "@/components/ij-icon";
import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/ipc-client";
import type { InvokeMap } from "@/shared/contract";

type LogData = InvokeMap["log:read"]["res"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function SqlLogTab() {
  const [data, setData] = React.useState<LogData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Lee el log. Sin setState síncrono al empezar (el efecto de montaje no debe disparar renders en cascada): el
  // «cargando» inicial ya viene del estado inicial y el de «Recargar» lo pone el botón.
  const fetchLog = React.useCallback(() => {
    invoke("log:read")
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        console.error("[sql-log] No se pudo leer el log SQL", err);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const load = () => {
    setLoading(true);
    fetchLog();
  };

  const lines = data?.content ? data.content.split("\n").filter(Boolean).length : 0;

  return (
    <div data-testid="sql-log-tab" className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--gdb-tab-h)] shrink-0 items-center gap-3 border-b border-border px-3 text-xs text-muted-foreground">
        <IjIcon name="history" />
        <span className="font-medium text-foreground">Log SQL</span>
        <span className="font-mono">{data?.path ?? "data/sql-log.jsonl"}</span>
        {data?.exists && (
          <span data-testid="sql-log-meta" className="flex items-center gap-2">
            <span>
              {formatBytes(data.totalBytes)} · {lines} línea(s)
            </span>
            {data.truncated && (
              <span className="flex items-center gap-1 rounded-full bg-gdb-warn/15 px-1.5 py-0.5 text-gdb-warnfg">
                <IjIcon name="warning" />
                mostrando solo el último {formatBytes(data.maxBytes)}
              </span>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px]">
          <IjIcon name="locked" />
          Solo lectura · todas las conexiones
        </span>
        <Button size="xs" variant="outline" onClick={load} disabled={loading} title="Volver a leer el log">
          <IjIcon name="refresh" />
          Recargar
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-4 text-xs text-destructive">No se pudo leer el log SQL: {error}</p>
        ) : !data ? (
          <p className="p-4 text-xs text-muted-foreground">Leyendo el log…</p>
        ) : !data.exists || !data.content ? (
          <p className="p-4 text-xs text-muted-foreground">
            El log está vacío: cada query que ejecutes (en cualquier conexión) se añade aquí.
          </p>
        ) : (
          <CodePreview value={data.content} language="json" className="h-full" />
        )}
      </div>
    </div>
  );
}
