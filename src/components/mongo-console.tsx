/**
 * Panel de la consola cuando la conexión es MongoDB (fase 80; la fase 81 le dio la vista de documentos).
 *
 * POR QUÉ EXISTE: el usuario pidió primero la CONEXIÓN y dejar la vista para después («la vista va a
 * cambiar»). La consola SQL no se monta contra un `MongodbDriver`: aquí no se escribe SQL.
 *
 * QUÉ HACE AHORA: en vez de un aviso, lista las colecciones de la base activa como accesos directos.
 * Cada una abre su pestaña con la vista de documentos (barra de consulta, tarjetas y paginación,
 * estilo MongoDB Compass), que es el camino natural: se hizo clic en la colección y se ven sus
 * documentos, sin pasar por «la vista todavía no está».
 */
import * as React from "react";
import { IjIcon } from "@/components/ij-icon";
import { cn } from "@/lib/utils";
import { getSchema } from "@/lib/api";
import { useAppDispatch } from "@/hooks/use-app-state";
import type { SchemaNode, Session } from "@/lib/types";

export function MongoConsole({ session }: { session: Session }) {
  const dispatch = useAppDispatch();
  const [colecciones, setColecciones] = React.useState<string[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    // El `await` va primero a propósito: el lint del repo prohíbe `setState` síncrono dentro de un
    // efecto (provoca renders en cascada). El estado inicial ya es «cargando».
    (async () => {
      try {
        const esquema: SchemaNode[] = await getSchema(session.sessionId);
        if (!vivo) return;
        // Para Mongo, el «esquema» es una sola sección con las colecciones de la base.
        setColecciones((esquema[0]?.tables ?? []).map((t) => t.name));
      } catch (err) {
        if (vivo) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [session.sessionId, session.database]);

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-editor px-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <IjIcon name="mongodb" className="size-8 text-gdb-enginemongo" />
        <p className="text-sm font-medium text-gdb-fgstrong">
          {session.name} · {session.database || "sin base seleccionada"}
        </p>
        <p className="max-w-md text-[11px] leading-relaxed text-gdb-fgmuted">
          Elegí una colección para ver sus documentos. También podés abrirla desde el explorador.
        </p>
      </div>

      {error && (
        <p role="alert" className="max-w-md text-center text-[11px] text-gdb-dangerfg">
          {error}
        </p>
      )}

      {cargando && !error && <p className="text-[11px] text-gdb-fgmuted">Cargando colecciones…</p>}

      {!cargando && !error && colecciones.length === 0 && (
        <p className="text-[11px] text-gdb-fgmuted">La base no tiene colecciones.</p>
      )}

      {colecciones.length > 0 && (
        <div className="grid max-h-[60%] w-full max-w-xl grid-cols-2 gap-1.5 overflow-auto">
          {colecciones.map((nombre) => (
            <button
              key={nombre}
              onClick={() =>
                dispatch({
                  type: "OPEN_TABLE_TAB",
                  payload: { schema: session.database || "", table: nombre },
                })
              }
              className={cn(
                "flex items-center gap-2 rounded border border-gdb-border px-2 py-1.5 text-left",
                "text-xs text-gdb-fg hover:border-gdb-accent/60 hover:bg-gdb-rowhover"
              )}
              title={`Abrir la colección ${nombre}`}
            >
              <IjIcon name="table" className="shrink-0" />
              <span className="truncate font-jetbrains">{nombre}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
