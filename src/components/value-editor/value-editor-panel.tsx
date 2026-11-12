/**
 * Value editor: el valor de la celda enfocada, en el dock derecho (fase 12, R37).
 *
 * Por qué existe: sin él, un `jsonb` o un `text` de 4 KB es una celda truncada ilegible, y el único
 * modo de leerlo es exportarlo o copiarlo a otro programa. Es la primera de las tres diferencias
 * que la investigación de DataGrip señala entre «grid que edita» y «analizador de datos»
 * (`research/datagrip-data-grid.md`).
 *
 * Decisiones de la fase 12 que se ven aquí:
 * - **D1**: vive en el dock derecho, que la fase 9 dejó reservado y vacío para esto.
 * - **D2**: se pinta con CodeMirror (resaltado JSON, soft-wrap), que ya era dependencia.
 * - **D3**: confirmar entra en la **barra de cambios pendientes**, nunca directo a la base.
 * - **D4**: los binarios se ven, no se editan.
 * - **D5**: SIGUE a la celda enfocada — moverse por el grid con el panel abierto es la forma
 *   natural de leer una columna larga fila a fila.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useCeldaEnfocada } from "@/lib/focused-cell";
import { presentarValor, tamanoLegible } from "./value-format";

export function ValueEditorPanel() {
  const celda = useCeldaEnfocada();

  const presentado = React.useMemo(
    () => (celda ? presentarValor(celda.valor, celda.tipo) : null),
    [celda]
  );

  /**
   * Borrador: lo que el usuario está escribiendo, que todavía NO es el valor. `null` significa «no
   * ha tocado nada». Se reinicia al cambiar de celda — si no, al moverse por la columna el borrador
   * de una fila acabaría escribiéndose encima de otra, que es la peor forma de perder un dato.
   */
  const [borrador, setBorrador] = React.useState<string | null>(null);
  const claveDeCelda = celda ? `${celda.columna}::${celda.indiceOriginal}` : null;
  const claveAnterior = React.useRef(claveDeCelda);
  if (claveAnterior.current !== claveDeCelda) {
    claveAnterior.current = claveDeCelda;
    if (borrador !== null) setBorrador(null);
  }

  const editable = Boolean(
    celda?.editable && celda?.confirmar && presentado && !presentado.soloLecturaPorTipo
  );
  const texto = borrador ?? presentado?.texto ?? "";
  const sucio = borrador !== null && borrador !== presentado?.texto;

  /**
   * Un JSON mal formado se avisa AQUÍ y no se manda: dejarlo pasar significa que la base lo rechaza
   * al guardar, con un error de driver lejos de donde se escribió la errata.
   */
  const errorJson = React.useMemo(() => {
    if (!sucio || presentado?.lenguaje !== "json" || texto.trim() === "") return null;
    try {
      JSON.parse(texto);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "JSON inválido";
    }
  }, [sucio, texto, presentado?.lenguaje]);

  const aplicar = React.useCallback(() => {
    if (!celda?.confirmar || !sucio || errorJson) return;
    celda.confirmar(texto);
    setBorrador(null);
  }, [celda, sucio, errorJson, texto]);

  const descartar = React.useCallback(() => setBorrador(null), []);


  if (!celda || !presentado) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Selecciona una celda para ver su valor.
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-testid="value-editor-panel"
      onKeyDown={(e) => {
        // ⌘Enter aplica y Escape descarta, en la línea de los editores de celda de la fase 11 (D3).
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          aplicar();
        } else if (e.key === "Escape" && sucio) {
          e.preventDefault();
          e.stopPropagation();
          descartar();
        }
      }}
    >
      {/* Cabecera: de qué columna es, de qué tipo y cuánto pesa. El tamaño importa — es la
          diferencia entre «esto es un texto» y «esto es un documento de 2 MB». */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/30 px-2 py-1.5">
        <span className="truncate text-xs font-medium" title={celda.columna}>
          {celda.columna}
        </span>
        <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {presentado.descripcion}
        </span>
        {!presentado.esNulo && (
          <span className="text-[10px] text-muted-foreground">{tamanoLegible(presentado.bytes)}</span>
        )}
        {presentado.soloLecturaPorTipo && (
          <span className="text-[10px] text-muted-foreground">sólo lectura</span>
        )}
        {!presentado.soloLecturaPorTipo && !celda.editable && (
          // Decirlo es parte del trato: una celda sin contexto de tabla o una clave primaria no se
          // edita, y el usuario merece saber por qué el panel no le deja escribir.
          <span className="text-[10px] text-muted-foreground" title="Sin contexto de tabla, o es clave primaria">
            no editable
          </span>
        )}
        {sucio && <span className="text-[10px] font-medium text-gdb-warnfg">sin aplicar</span>}
      </div>

      <div className="min-h-0 flex-1">
        {presentado.esNulo && !sucio ? (
          // NULL no es la cadena vacía, y el panel no puede dejar esa duda abierta.
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <span className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
              NULL
            </span>
            {editable && (
              <Button size="xs" variant="outline" onClick={() => setBorrador("")}>
                Escribir un valor
              </Button>
            )}
          </div>
        ) : (
          /*
            Un textarea, no un editor: aquí se PEGA o se corrige el valor de una celda, no se navega
            ni se pliega código. CodeMirror sobraba para esto (dos extensiones y un tema para pintar
            JSON) y se fue con el resto del editor (2026-10-20). Con `wrap` un valor de 50 KB sigue
            sin necesitar scroll horizontal.
          */
          <textarea
            value={texto}
            readOnly={!editable}
            onChange={(e) => setBorrador(e.target.value)}
            spellCheck={false}
            wrap="soft"
            aria-label={`Valor de ${celda.columna}`}
            className="h-full w-full resize-none overflow-auto bg-transparent p-2 font-mono text-xs leading-5 text-gdb-fg outline-none"
            data-testid="value-editor"
          />
        )}
      </div>

      {editable && (
        <div className="flex shrink-0 flex-col gap-1 border-t border-border bg-muted/30 px-2 py-1.5">
          {errorJson && (
            // Nunca fallar en silencio: el error se ve aquí, no en el driver tres pasos después.
            <span className="truncate text-[10px] text-gdb-fail" title={errorJson}>
              JSON inválido: {errorJson}
            </span>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">⌘↵ aplica · ⎋ descarta</span>
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={descartar} disabled={!sucio}>
                Descartar
              </Button>
              <Button size="xs" onClick={aplicar} disabled={!sucio || Boolean(errorJson)}>
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
