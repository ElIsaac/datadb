import * as React from "react";
import { useAppState, useActiveSession, useActiveConsole } from "@/hooks/use-app-state";
import { connectionOf } from "@/lib/console-binding";
import { formatElapsed, useQueryProgress } from "@/hooks/use-query-progress";
import { IjIcon } from "@/components/ij-icon";
import { isDeepSeekModel, MISSING_KEY_MESSAGE } from "@/lib/ai";
import { AI_PROVIDER_LABELS, activeModelOf } from "@/lib/ai-types";
import { DEFAULT_PROFILE_COLOR } from "@/lib/profile-colors";
import { readOnlyEnforcedByDatabase, readOnlyProtectionNote } from "@/server/db/read-only-session";

export function StatusBar() {
  const state = useAppState();
  // La barra de estado refleja la conexión de la CONSOLA CON FOCO, no una
  // sesión global (ya no existe tal cosa con multi-conexión).
  const session = useActiveSession();
  // R91: la conexión DORMIDA (atada, sin sesión) también se enseña, con «se conecta al ejecutar».
  const conexion = connectionOf(useActiveConsole());
  const settings = state.aiSettings;
  const progress = useQueryProgress(session?.sessionId);

  const modelStatus = React.useMemo(() => {
    if (!settings || !settings.enabled) return null;
    // Fase 25 (R24): modelo del proveedor ACTIVO, y el proveedor a la vista (antes se asumía OpenRouter).
    const { model } = activeModelOf(settings);
    const cheap = isDeepSeekModel(model) || model.toLowerCase().startsWith("deepseek");
    return { model, cheap, provider: AI_PROVIDER_LABELS[settings.provider] ?? "OpenRouter" };
  }, [settings]);

  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t bg-muted/50 px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        {conexion ? (
          <>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: conexion.color || DEFAULT_PROFILE_COLOR }}
            />
            <span className="font-medium text-foreground">{conexion.name}</span>
            <span className="font-mono">{conexion.database}</span>
            {!conexion.live && <span data-testid="conexion-dormida">· se conecta al ejecutar</span>}
            {conexion.readOnly && (
              <span
                className="flex items-center gap-1 rounded-full bg-gdb-warn/15 px-1.5 py-0.5 text-gdb-warnfg"
                title={`Conexión de solo lectura: INSERT/UPDATE/DELETE/DDL bloqueados. ${readOnlyProtectionNote(conexion.type)}`}
              >
                <IjIcon name="locked" />
                Solo lectura
                {/* R53: en SQL Server la protección es parcial (solo el análisis del SQL); se nota sin abrir el tooltip. */}
                {!readOnlyEnforcedByDatabase(conexion.type) && <IjIcon name="warning" label="Protección parcial" />}
              </span>
            )}
          </>
        ) : (
          <span>Sin conexión</span>
        )}
      </div>

      {/* Fase 3 (T4, R4): mientras la consola con foco tiene una query en curso, el contador sustituye al mensaje.
          Sale de los eventos query:started/finished del worker (use-query-progress.ts), no del estado de la UI. */}
      {progress ? (
        <span
          data-testid="query-progress"
          className="flex items-center gap-1.5 truncate text-foreground"
          title="Consulta en curso (Cancelar en la barra del editor)"
        >
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          Ejecutando… {formatElapsed(progress.elapsedMs)}
        </span>
      ) : (
        <span className="truncate">{state.statusMessage || "Listo"}</span>
      )}

      <div className="flex items-center gap-3">
        {modelStatus && (
          <span
            className="flex items-center gap-1 rounded-full border px-1.5 py-0.5"
            data-testid="ai-model-status"
            title={`IA: ${modelStatus.provider} · ${modelStatus.model}${modelStatus.cheap ? " (DeepSeek)" : ""}`}
          >
            <IjIcon name="ai" />
            <span className="text-muted-foreground">{modelStatus.provider} ·</span>
            <span className="max-w-[160px] truncate">{modelStatus.model}</span>
            {modelStatus.cheap && (
              <span className="text-gdb-okfg">barato</span>
            )}
          </span>
        )}
        {state.aiLastUsage && (
          <span title="Tokens usados en la última petición de IA">
            {state.aiLastUsage.promptTokens}+{state.aiLastUsage.completionTokens} tokens
          </span>
        )}
        {settings && !settings.hasApiKey && (
          <span
            className="flex items-center gap-1 rounded-full border border-gdb-warn/30 bg-gdb-warn/10 px-1.5 py-0.5 text-gdb-warnfg"
            title={MISSING_KEY_MESSAGE}
          >
            <IjIcon name="warning" />
            IA sin API key
          </span>
        )}
        <span className="hidden sm:inline">⌘K Comandos</span>
        <span className="hidden sm:inline">⌘↵ Ejecutar</span>
      </div>
    </div>
  );
}
