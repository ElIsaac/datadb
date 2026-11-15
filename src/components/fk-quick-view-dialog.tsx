import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IjIcon } from "@/components/ij-icon";
import { EditableCell } from "@/components/editable-cell";
import { useAppState } from "@/hooks/use-app-state";
import { batchEdit, runQuery as apiRunQuery } from "@/lib/api";
import { quoteIdentifier, quoteValue } from "@/lib/quote";
import { dialectoSql } from "@/shared/connection-net";
import {
  booleanoParaGuardar,
  esColumnaBooleana,
  pintarCelda,
  tokenDeColorPorTipo,
  valorBooleano,
  type TokenDeTipo,
} from "@/components/grid/cell-model";
import type { QueryResult, Session } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FkQuickTarget {
  schema: string;
  table: string;
  column: string;
  value: unknown;
}

interface FkQuickViewDialogProps {
  target: FkQuickTarget | null;
  session: Session | null;
  onClose: () => void;
  onOpenInTab: (target: FkQuickTarget) => void;
}

const CLASE_POR_TOKEN: Record<TokenDeTipo, string> = {
  "--gdb-num": "text-gdb-num",
  "--gdb-fn": "text-gdb-fn",
  "--gdb-str": "text-gdb-str",
};

function formatCellPreview(value: unknown, columnType = "") {
  const pintada = pintarCelda(value, columnType);
  if (pintada.esNulo) {
    return (
      <span className="inline-block rounded bg-gdb-contrast/70 px-1.5 py-[1px] font-jetbrains text-[11px] italic text-gdb-fgmuted">
        NULL
      </span>
    );
  }

  const boolVal =
    typeof value === "boolean"
      ? value
      : esColumnaBooleana(columnType)
        ? valorBooleano(value)
        : null;
  if (boolVal !== null) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-[1px] font-jetbrains text-[11px] font-semibold",
          boolVal ? "bg-gdb-okbg text-gdb-okfg" : "bg-gdb-dangerbg text-gdb-dangerfg"
        )}
      >
        {boolVal ? "true" : "false"}
      </span>
    );
  }

  const token =
    tokenDeColorPorTipo(columnType) ??
    (typeof value === "number" ? "--gdb-num" : typeof value === "object" ? "--gdb-str" : null);
  const colorClass = token ? CLASE_POR_TOKEN[token] : "text-gdb-fgstrong";

  return (
    <span className={cn("break-all font-jetbrains text-[12px]", colorClass)}>
      {pintada.texto}
    </span>
  );
}

function FkQuickViewBody({
  target,
  session,
  onClose,
  onOpenInTab,
}: {
  target: FkQuickTarget;
  session: Session;
  onClose: () => void;
  onOpenInTab: (target: FkQuickTarget) => void;
}) {
  const { schema } = useAppState();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<QueryResult | null>(null);
  const [rowIndex, setRowIndex] = React.useState(0);
  const [editingCol, setEditingCol] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, unknown>>({});

  const pkColumn = React.useMemo(() => {
    const node = schema?.find((s) => s.name === target.schema);
    const table = node?.tables.find((t) => t.name === target.table);
    const pks = table?.columns.filter((c) => c.isPrimaryKey) ?? [];
    return pks.length === 1 ? pks[0].name : null;
  }, [schema, target.schema, target.table]);

  const buildQuerySql = React.useCallback(() => {
    const dialect = dialectoSql(session.type);
    const qualifiedTable = target.schema
      ? `${quoteIdentifier(target.schema, dialect)}.${quoteIdentifier(target.table, dialect)}`
      : quoteIdentifier(target.table, dialect);
    return `SELECT * FROM ${qualifiedTable} WHERE ${quoteIdentifier(target.column, dialect)} = ${quoteValue(target.value)}`;
  }, [session.type, target.schema, target.table, target.column, target.value]);

  const cargar = React.useCallback(async () => {
    try {
      const res = await apiRunQuery(session.sessionId, buildQuerySql());
      setResult(res);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [session.sessionId, buildQuerySql]);

  React.useEffect(() => {
    let cancelled = false;
    apiRunQuery(session.sessionId, buildQuerySql())
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId, buildQuerySql]);

  const rows = result?.rows ?? [];
  const currentRow = rows[rowIndex];
  const columns = result?.columns ?? [];
  const pkValue = pkColumn && currentRow ? currentRow[pkColumn] : undefined;
  const canEdit = Boolean(pkColumn && currentRow && pkValue !== undefined && pkValue !== null);
  const editCount = Object.keys(edits).length;

  function setColEdit(colName: string, nextVal: unknown) {
    if (!currentRow) return;
    const orig = currentRow[colName];
    setEdits((prev) => {
      if (Object.is(orig, nextVal)) {
        const copy = { ...prev };
        delete copy[colName];
        return copy;
      }
      return { ...prev, [colName]: nextVal };
    });
  }

  async function handleSaveEdits() {
    if (!canEdit || !pkColumn || editCount === 0) return;
    setSaving(true);
    try {
      await batchEdit(session.sessionId, {
        schema: target.schema || undefined,
        table: target.table,
        pkColumn,
        operations: [{ type: "update", pkValue, changes: edits }],
      });
      setEdits({});
      setEditingCol(null);
      await cargar();
      toast.success("Cambios guardados");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-0 overflow-hidden border-gdb-sep bg-gdb-chrome p-0 text-gdb-fg">
      <DialogHeader className="border-b border-gdb-sep bg-gdb-th px-4 py-3">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gdb-fgstrong">
          <IjIcon name="table" className="text-gdb-icotbl" />
          <span>
            {target.schema ? `${target.schema}.` : ""}
            {target.table}
          </span>
          <span className="rounded border border-gdb-sep bg-gdb-editor px-2 py-0.5 font-jetbrains text-[11px] font-normal text-gdb-fgdim">
            {target.column} = {String(target.value ?? "NULL")}
          </span>
          {result && (
            <span className="ml-auto font-jetbrains text-[11px] font-normal text-gdb-fgmuted">
              {rows.length} {rows.length === 1 ? "fila" : "filas"} · {result.durationMs}ms
            </span>
          )}
        </DialogTitle>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto bg-gdb-editor">
        {loading && (
          <div className="px-4 py-8 text-center text-xs text-gdb-fgmuted">
            Consultando registro referenciado…
          </div>
        )}

        {!loading && error && (
          <div className="m-3 rounded border border-gdb-dangerborder bg-gdb-dangerbg px-3 py-2 text-xs text-gdb-dangerfg">
            {error}
          </div>
        )}

        {!loading && !error && result && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-gdb-fgmuted">
            No se encontró ningún registro coincidente.
          </div>
        )}

        {!loading && !error && currentRow && (
          <div className="divide-y divide-gdb-sep/50">
            {columns.map((col, idx) => {
              const isMatchedKey = col.name === target.column;
              const isPk = col.name === pkColumn;
              const colEditable = canEdit && !isPk;
              const hasEdit = Object.prototype.hasOwnProperty.call(edits, col.name);
              const val = hasEdit ? edits[col.name] : currentRow[col.name];
              const colType = col.type ?? "";
              const boolVal =
                typeof val === "boolean"
                  ? val
                  : esColumnaBooleana(colType)
                    ? valorBooleano(val)
                    : null;
              const isEditingThis = editingCol === col.name;

              return (
                <div
                  key={col.name}
                  className={cn(
                    "grid grid-cols-[minmax(150px,40%)_minmax(0,1fr)] items-center gap-3 px-4 py-1.5 text-xs",
                    idx % 2 === 1 && !hasEdit && "bg-gdb-chrome/35",
                    isMatchedKey && !hasEdit && "bg-gdb-accent/10",
                    hasEdit && "bg-gdb-diffmod/40"
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 font-jetbrains text-[11.5px] text-gdb-fgdim">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {isMatchedKey && (
                        <IjIcon name="primaryKey" className="shrink-0 text-gdb-icokey" />
                      )}
                      <span className="truncate" title={col.name}>
                        {col.name}
                      </span>
                    </span>
                    {col.type && (
                      <span className="shrink-0 rounded border border-gdb-sep/60 px-1 text-[10px] text-gdb-fgmuted">
                        {col.type}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    {isEditingThis ? (
                      <EditableCell
                        enLinea
                        value={val}
                        columnType={col.type}
                        onCommit={(nuevo) => {
                          setColEdit(col.name, nuevo);
                          setEditingCol(null);
                        }}
                        onCancel={() => setEditingCol(null)}
                      />
                    ) : colEditable && boolVal !== null ? (
                      <button
                        type="button"
                        onClick={() =>
                          setColEdit(col.name, booleanoParaGuardar(currentRow[col.name], !boolVal))
                        }
                        title="Clic para alternar true/false"
                        className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gdb-accent"
                      >
                        {formatCellPreview(val, colType)}
                      </button>
                    ) : colEditable ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingCol(col.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "F2") {
                            e.preventDefault();
                            setEditingCol(col.name);
                          }
                        }}
                        title="Clic para editar valor"
                        className="cursor-text rounded px-1 py-0.5 hover:bg-gdb-rowhover"
                      >
                        {formatCellPreview(val, colType)}
                      </div>
                    ) : (
                      formatCellPreview(val, colType)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DialogFooter className="flex items-center justify-between border-t border-gdb-sep bg-gdb-chrome px-4 py-2.5 sm:justify-between">
        <div className="flex items-center gap-1.5">
          {rows.length > 1 && (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={rowIndex <= 0}
                onClick={() => {
                  setEdits({});
                  setEditingCol(null);
                  setRowIndex((i) => Math.max(0, i - 1));
                }}
                className="border-gdb-sep"
              >
                ◀
              </Button>
              <span className="font-jetbrains text-[11px] text-gdb-fgdim">
                {rowIndex + 1} / {rows.length}
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={rowIndex >= rows.length - 1}
                onClick={() => {
                  setEdits({});
                  setEditingCol(null);
                  setRowIndex((i) => Math.min(rows.length - 1, i + 1));
                }}
                className="border-gdb-sep"
              >
                ▶
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editCount > 0 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setEdits({});
                  setEditingCol(null);
                }}
                className="h-7 text-xs text-gdb-dangerfg hover:bg-gdb-dangerbg"
              >
                Descartar
              </Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => void handleSaveEdits()}
                className="h-7 gap-1 text-xs"
              >
                {saving ? "Guardando…" : `Guardar (${editCount})`}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-xs">
            Cerrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onOpenInTab(target);
              onClose();
            }}
            className="h-7 gap-1.5 border-gdb-sep text-xs"
          >
            <IjIcon name="table" />
            Abrir en pestaña
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Vista rápida de un registro referenciado por llave foránea. Permite inspeccionar sus campos
 * sin abandonar la consulta actual y ofrece abrir la tabla filtrada en una pestaña completa.
 */
export function FkQuickViewDialog({
  target,
  session,
  onClose,
  onOpenInTab,
}: FkQuickViewDialogProps) {
  return (
    <Dialog open={target !== null && session !== null} onOpenChange={(open) => !open && onClose()}>
      {target && session && (
        <FkQuickViewBody
          key={`${session.sessionId}:${target.schema}.${target.table}.${target.column}=${String(target.value)}`}
          target={target}
          session={session}
          onClose={onClose}
          onOpenInTab={onOpenInTab}
        />
      )}
    </Dialog>
  );
}
