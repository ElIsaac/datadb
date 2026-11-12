import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodePreview } from "@/components/code-preview";
import {
  COMMON_COLUMN_TYPES,
  buildTableDdlFromColumns,
  newBuilderColumn,
  type BuilderColumn,
  type DdlDialect,
} from "@/lib/ddl-templates";
import { copyToClipboard } from "@/lib/export-formats";
import { CopyIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

interface TableBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialect: DdlDialect;
  schema: string;
  /** Se llama con el DDL final cuando el usuario elige "Usar en editor SQL". */
  onUseInEditor: (ddl: string) => void;
}

/**
 * Editor visual de tabla al estilo DataGrip: agrega/edita/elimina columnas
 * desde controles de formulario y previsualiza el CREATE TABLE resultante
 * en vivo, sin tener que escribir el DDL a mano.
 */
export function TableBuilderDialog({
  open,
  onOpenChange,
  dialect,
  schema,
  onUseInEditor,
}: TableBuilderDialogProps) {
  const [tableName, setTableName] = React.useState("nueva_tabla");
  const [columns, setColumns] = React.useState<BuilderColumn[]>(() => [
    { ...newBuilderColumn(dialect), name: "id", type: COMMON_COLUMN_TYPES[dialect][0], nullable: false, primaryKey: true, autoIncrement: true },
  ]);

  const ddl = React.useMemo(
    () => buildTableDdlFromColumns(dialect, schema, tableName, columns),
    [dialect, schema, tableName, columns]
  );

  function updateColumn(index: number, patch: Partial<BuilderColumn>) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addColumn() {
    setColumns((prev) => [...prev, newBuilderColumn(dialect)]);
  }

  function removeColumn(index: number) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCopy() {
    try {
      await copyToClipboard(ddl);
      toast.success("DDL copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  function handleUseInEditor() {
    onUseInEditor(ddl);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilIcon className="size-4" />
            Nueva tabla — editor visual
          </DialogTitle>
          <DialogDescription>
            Agrega columnas con la interfaz; el DDL se genera automáticamente abajo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground shrink-0">Schema.Tabla</Label>
          <span className="text-xs text-muted-foreground font-jetbrains">{schema}.</span>
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            className="h-8 max-w-52 font-jetbrains text-sm"
            placeholder="nombre_tabla"
          />
        </div>

        <div className="flex-1 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Columna</th>
                <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                <th className="px-2 py-1.5 text-center font-medium">Null</th>
                <th className="px-2 py-1.5 text-center font-medium">PK</th>
                <th className="px-2 py-1.5 text-center font-medium">Auto</th>
                <th className="px-2 py-1.5 text-left font-medium">Default</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">
                    <Input
                      value={col.name}
                      onChange={(e) => updateColumn(i, { name: e.target.value })}
                      placeholder="nombre_columna"
                      className="h-7 font-jetbrains text-xs"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={col.type}
                      onValueChange={(v) => updateColumn(i, { type: v ?? col.type })}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs" aria-label="Tipo de columna">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_COLUMN_TYPES[dialect].map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      onChange={(e) => updateColumn(i, { nullable: e.target.checked })}
                      className="size-3.5 accent-primary"
                      title="Permite NULL"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onChange={(e) =>
                        updateColumn(i, {
                          primaryKey: e.target.checked,
                          nullable: e.target.checked ? false : col.nullable,
                        })
                      }
                      className="size-3.5 accent-primary"
                      title="Primary key"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={col.autoIncrement}
                      disabled={!col.primaryKey}
                      onChange={(e) => updateColumn(i, { autoIncrement: e.target.checked })}
                      className="size-3.5 accent-primary disabled:opacity-30"
                      title="Autoincrement (solo PK)"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={col.defaultValue}
                      onChange={(e) => updateColumn(i, { defaultValue: e.target.value })}
                      placeholder="—"
                      className="h-7 w-28 font-jetbrains text-xs"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => removeColumn(i)}
                      disabled={columns.length === 1}
                      title="Eliminar columna"
                    >
                      <TrashIcon className="size-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button size="xs" variant="outline" onClick={addColumn} className="self-start">
          <PlusIcon className="size-3" />
          Agregar columna
        </Button>

        <div className="min-h-32 flex-1 overflow-auto rounded-md border">
          <CodePreview value={ddl} language="sql" className="h-full min-w-max text-xs" />
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button size="sm" variant="ghost" onClick={handleCopy}>
            <CopyIcon className="size-3.5" />
            Copiar DDL
          </Button>
          <Button size="sm" onClick={handleUseInEditor}>
            Usar en editor SQL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
