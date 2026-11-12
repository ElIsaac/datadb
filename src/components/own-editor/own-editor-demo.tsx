import * as React from "react";
import { XIcon } from "lucide-react";
import { OwnEditor } from "./own-editor";
import { buildSqlDiagnostics, type SqlLintDiagnostic } from "@/lib/sql-lint";
import type { SchemaNode } from "@/lib/types";
import { schemaSuggestions } from "@/lib/editor-suggest";

/**
 * Sugerencias de la demo. En la app serán las del esquema real (`sql-scope.ts`) más las palabras
 * clave; aquí basta con que se pueda sentir el popup: prefijo, flechas, ⏎/⇥ y clic.
 */
/**
 * Esquema de la demo, el mínimo para que las inspecciones tengan algo contra lo que mirar. En la
 * app será el esquema real de la conexión (`state.schema`), el mismo que usa el editor actual.
 */
const ESQUEMA: SchemaNode[] = [
  {
    name: "public",
    routines: [],
    triggers: [],
    tables: [
      {
        name: "clientes",
        type: "table",
        columns: [
          { name: "id", type: "int4", isPrimaryKey: true, nullable: false },
          { name: "nombre", type: "text", isPrimaryKey: false, nullable: false },
          { name: "ciudad", type: "text", isPrimaryKey: false, nullable: true },
          { name: "activo", type: "bool", isPrimaryKey: false, nullable: false },
        ],
      },
      {
        name: "pedidos",
        type: "table",
        columns: [
          { name: "id", type: "int4", isPrimaryKey: true, nullable: false },
          { name: "cliente_id", type: "int4", isPrimaryKey: false, nullable: false },
          { name: "fecha", type: "date", isPrimaryKey: false, nullable: false },
        ],
      },
    ],
  },
];


/**
 * Ventana de prueba del editor propio (spike F2-B).
 *
 * Se abre desde la paleta de comandos (⌘K → «editor propio») y NO toca la consola: la consola sigue
 * con el editor de siempre hasta que el usuario apruebe este. Aquí se puede teclear, seleccionar,
 * deshacer, mover líneas, comentar y probar los acentos/ñ con el IME de macOS — que es lo que una
 * captura no demuestra.
 */

const EJEMPLO = `-- Editor propio (spike F2-B). Teclea, selecciona, ⌘Z, ⌥↑, ⌘/, IME.
select c.id, c.nombre, count(p.id) as pedidos
from clientes c
left join pedidos p on p.cliente_id = c.id
where c.ciudad = 'México' and c.activo = true
group by c.id, c.nombre
having count(p.id) > 3
order by pedidos desc
limit 100;

-- Error a propósito: nombr no existe (la inspección lo subraya)
select c.nombr from clientes c;

-- Cadenas, números y comentarios: 42, 3.14, 'texto con ñ y acentos'
select "una columna rara", now()::date;
`;

export function OwnEditorDemo({ onClose }: { onClose: () => void }) {
  const [sql, setSql] = React.useState(EJEMPLO);
  const [diagnosticos, setDiagnosticos] = React.useState<SqlLintDiagnostic[]>([]);
  /** Última acción de app disparada por un atajo: se muestra en la cabecera para poder medirla. */
  const [accion, setAccion] = React.useState<string>("");
  const sugerencias = React.useMemo(() => schemaSuggestions(ESQUEMA), []);

  /**
   * Los diagnósticos se recalculan con retardo: `buildSqlDiagnostics` recorre el documento entero y
   * en un documento de 10 000 líneas no puede correr en cada pulsación. En la consola, además, solo
   * tiene sentido con el esquema cargado.
   */
  React.useEffect(() => {
    const timer = setTimeout(() => setDiagnosticos(buildSqlDiagnostics(sql, ESQUEMA, "public")), 250);
    return () => clearTimeout(timer);
  }, [sql]);

  /**
   * Carga 10 000 líneas para medir el caso del presupuesto (< 16 ms por pulsación). Es también la
   * forma de que el usuario sienta el scroll y el coloreado por ventana sin montar una base.
   */
  const cargarDiezMil = () => {
    setSql(
      Array.from(
        { length: 10_000 },
        (_, i) => `select c${i}.id, c${i}.nombre from clientes c${i} where c${i}.id = ${i} and c${i}.activo = true;`
      ).join("\n")
    );
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="spike-editor-propio">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border/60 px-3 text-xs">
        <span className="font-medium">Editor propio (spike F2-B)</span>
        <span className="text-muted-foreground">
          Teclea, selecciona, ⌘Z, ⇧⌘Z, ⌥↑/⌥↓, ⌘D, ⌘/, ⇥/⇧⇥ · ⎋ cierra
        </span>
        {accion && (
          <span className="rounded-sm bg-muted px-2 py-0.5 text-[11px] text-foreground" data-testid="ultima-accion">
            atajo: {accion}
          </span>
        )}
        <button
          type="button"
          className="ml-auto rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={cargarDiezMil}
        >
          10 000 líneas
        </button>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <OwnEditor
          value={sql}
          onChange={setSql}
          minHeight="100%"
          className="h-full"
          dialecto="postgres"
          suggest={() => sugerencias}
          diagnostics={diagnosticos}
          onAction={setAccion}
        />
      </div>
    </div>
  );
}
