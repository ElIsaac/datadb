/**
 * Diálogo de documento de Mongo (fase 86): insertar, duplicar y editar el documento entero como JSON.
 *
 * POR QUÉ UN DIÁLOGO Y NO LA TARJETA: editar un documento completo (con sus objetos y arrays
 * anidados) en la tarjeta exigiría un árbol de inputs sin fin. Aquí se ve y se edita el JSON de una
 * vez, que es lo que hace Compass al abrir un documento, y la tarjeta se queda para el día a día
 * (campos escalares, fase 85).
 *
 * El texto acepta la misma sintaxis que la barra de consulta (`{ campo: valor }`, `ObjectId("…")`): el
 * usuario escribe en el mismo idioma en los dos sitios. La validación es explícita —no se cierra el
 * diálogo con un JSON roto— y el error se muestra DEBAJO del texto, no en un toast.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parsearDocumentoJson } from "@/shared/mongo-document-json";

export type ModoDeDocumento = "insertar" | "duplicar" | "editar";

const TITULO: Record<ModoDeDocumento, string> = {
  insertar: "Nuevo documento",
  duplicar: "Duplicar documento",
  editar: "Editar documento",
};

const AYUDA: Record<ModoDeDocumento, string> = {
  insertar: "Se inserta tal cual. Si no pones _id, lo genera el servidor.",
  duplicar: "Se copia sin el _id: el servidor le da uno nuevo.",
  editar: "Se guardan solo los campos que cambien. El _id no se toca.",
};

export function MongoDocumentDialog({
  abierto,
  modo,
  textoInicial,
  onCerrar,
  onGuardar,
  guardando,
  errorServidor,
}: {
  abierto: boolean;
  modo: ModoDeDocumento;
  textoInicial: string;
  onCerrar: () => void;
  onGuardar: (documento: Record<string, unknown>) => void;
  guardando: boolean;
  errorServidor: string | null;
}) {
  const [texto, setTexto] = React.useState(textoInicial);
  const [error, setError] = React.useState<string | null>(null);

  // Al abrir con otro documento, el texto parte del que toca (no del anterior).
  React.useEffect(() => {
    if (!abierto) return;
    // El `setState` va dentro de un microtask: el lint del repo prohíbe tocarlo de forma síncrona.
    void Promise.resolve().then(() => {
      setTexto(textoInicial);
      setError(null);
    });
  }, [abierto, textoInicial]);

  function guardar() {
    const r = parsearDocumentoJson(texto);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onGuardar(r.documento);
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="border-gdb-sep bg-gdb-chrome sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{TITULO[modo]}</DialogTitle>
          <DialogDescription className="text-[11px]">{AYUDA[modo]}</DialogDescription>
        </DialogHeader>

        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // ⌘⏎ guarda; ⏎ sigue siendo un salto de línea, que es lo que se espera en JSON.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              guardar();
            }
          }}
          aria-label="Documento en JSON"
          spellCheck={false}
          rows={14}
          className="w-full resize-y rounded-md border border-gdb-sep bg-gdb-editor p-3 font-jetbrains text-[11px] leading-[1.5] text-gdb-fg outline-none focus-visible:border-gdb-accent"
        />

        {(error ?? errorServidor) && (
          <p role="alert" className="rounded border border-gdb-dangerbg bg-gdb-dangerbg px-2 py-1 text-[11px] text-gdb-dangerfg">
            {error ?? errorServidor}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={guardando} className="h-7 border-gdb-border bg-transparent">
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando} className="h-7">
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmación de borrado: borrar un documento no se deshace, así que se pregunta. */
export function MongoBorrarDialog({
  abierto,
  resumen,
  onCerrar,
  onConfirmar,
  borrando,
  error,
}: {
  abierto: boolean;
  /** Un vistazo del documento (su `_id`), para no borrar a ciegas. */
  resumen: string;
  onCerrar: () => void;
  onConfirmar: () => void;
  borrando: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Borrar documento</DialogTitle>
          <DialogDescription className="text-[11px]">
            Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <p className="font-jetbrains text-[11px] text-gdb-fg">{resumen}</p>
        {error && (
          <p role="alert" className="rounded border border-gdb-dangerbg bg-gdb-dangerbg px-2 py-1 text-[11px] text-gdb-dangerfg">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={borrando} className="h-7 border-gdb-border bg-transparent">
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirmar} disabled={borrando} className="h-7">
            {borrando ? "Borrando…" : "Borrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
