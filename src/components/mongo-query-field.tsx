/**
 * Campo de consulta de Mongo con resaltado de sintaxis y autocompletado (fase 83).
 *
 * CÓMO SE PINTA: un `<input>` no deja colorear por dentro, así que se dibuja un ESPEJO detrás (un
 * `<div>` con el mismo texto, ya troceado por tipo) y el `<input>` va encima con el texto
 * TRANSPARENTE y el `caret` visible. Para que coincidan al píxel, las dos capas comparten fuente,
 * tamaño, `padding`, `line-height` y `white-space: pre`; si una cambia, hay que cambiar la otra o el
 * texto se ve desfasado.
 *
 * AUTOCOMPLETADO: al escribir se mira en qué posición está el cursor (`contextoEn`) y se ofrecen los
 * campos reales de la colección o los operadores con su explicación (`candidatosEn`). Es lo que Mongo
 * no da: los campos los detecta, pero no dice que un LIKE se hace con `$regex`.
 *
 * NAVEGACIÓN: ↑ ↓ mueven, ⏎ o Tab aceptan, ⎋ cierra. El auto-cierre de llaves sigue funcionando
 * (`alAbrir`/`alCerrar`), y cuando el popup está abierto ⏎ acepta en vez de ejecutar la búsqueda.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { alAbrir, alBorrar, alCerrar, type EdicionDeTexto } from "@/lib/auto-pair";
import { tokenizarConsulta, type TipoToken } from "@/lib/mongo-highlight";
import {
  aplicarCandidato,
  candidatosEn,
  contextoEn,
  type Candidato,
} from "@/lib/mongo-completion";

/** Color por tipo de token, con los tokens de sintaxis del tema (nada de colores literales). */
const CLASE_TOKEN: Record<TipoToken, string> = {
  llave: "text-gdb-fgmuted",
  clave: "text-gdb-fgstrong",
  cadena: "text-gdb-str",
  numero: "text-gdb-num",
  literal: "text-gdb-kw",
  operador: "text-gdb-const",
  constructor: "text-gdb-fn",
  espacio: "",
  texto: "text-gdb-fg",
};

/** Las dos capas tienen que usar EXACTAMENTE estas clases métricas. */
const METRICA = "font-jetbrains text-xs leading-7";

export function MongoQueryField({
  valor,
  onCambio,
  onEnter,
  placeholder,
  ariaLabel,
  campos = [],
  autoCompletar = true,
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  /** ⏎ cuando el autocompletado no está abierto (ejecutar la consulta). */
  onEnter?: () => void;
  placeholder?: string;
  ariaLabel: string;
  /** Rutas de campo para el autocompletado (`detalle.pais`). */
  campos?: string[];
  autoCompletar?: boolean;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const espejoRef = React.useRef<HTMLDivElement | null>(null);
  const [abierto, setAbierto] = React.useState(false);
  const [indice, setIndice] = React.useState(0);
  /**
   * Posición del cursor en ESTADO, no leída del ref durante el render: leer `ref.current` mientras se
   * renderiza está prohibido por el lint del repo (y React puede no haber aplicado el DOM todavía).
   * Se actualiza al escribir, al mover el cursor y al hacer clic.
   */
  const [cursor, setCursor] = React.useState(0);
  const contexto = React.useMemo(() => contextoEn(valor, cursor), [valor, cursor]);
  const candidatos = React.useMemo<Candidato[]>(
    () => (autoCompletar && abierto ? candidatosEn(contexto, campos) : []),
    [autoCompletar, abierto, contexto, campos]
  );

  const tokens = React.useMemo(() => tokenizarConsulta(valor), [valor]);
  // La lista cambia al teclear: el índice guardado puede quedar fuera, así que se acota aquí.
  const indiceActivo = candidatos.length ? Math.min(indice, candidatos.length - 1) : 0;

  function aplicar(r: EdicionDeTexto) {
    onCambio(r.valor);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.cursor, r.cursor);
    });
  }

  function aceptar(c: Candidato) {
    const el = inputRef.current;
    if (!el) return;
    const desde = el.selectionStart ?? valor.length;
    const r = aplicarCandidato(valor, desde, contexto.desde, c.insercion);
    onCambio(r.texto);
    setAbierto(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.cursor, r.cursor);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const inicio = el.selectionStart ?? el.value.length;
    const fin = el.selectionEnd ?? inicio;

    // --- Autocompletado abierto -------------------------------------------
    if (abierto && candidatos.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndice((i) => (i + 1) % candidatos.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndice((i) => (i - 1 + candidatos.length) % candidatos.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        aceptar(candidatos[indiceActivo]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAbierto(false);
        return;
      }
    }

    // --- Auto-cierre -------------------------------------------------------
    let r: EdicionDeTexto | null = null;
    if (e.key === "Backspace") {
      r = alBorrar(el.value, inicio, fin);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      r = alAbrir(el.value, inicio, fin, e.key) ?? alCerrar(el.value, inicio, fin, e.key);
    }
    if (r) {
      e.preventDefault();
      aplicar(r);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.();
      return;
    }
    if (e.key === "ArrowDown" && !abierto) setAbierto(true);
  }

  return (
    <div
      className={cn(
        // El fondo y el borde viven en el CONTENEDOR: el input tiene que ser transparente o su
        // `background` tapa el espejo que va detrás (síntoma: la barra se ve vacía aunque haya texto).
        "relative min-w-0 flex-1 rounded-lg border border-gdb-border bg-gdb-field",
        "focus-within:border-gdb-accent",
        className
      )}
    >
      {/* Espejo coloreado: mismas métricas que el input, sin eventos. */}
      <div
        ref={espejoRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-2.5 py-1",
          METRICA,
          !valor && "text-gdb-fgmuted"
        )}
      >
        {valor ? (
          tokens.map((t, i) => (
            <span key={i} className={CLASE_TOKEN[t.tipo]}>
              {t.texto}
            </span>
          ))
        ) : (
          <span>{placeholder}</span>
        )}
      </div>

      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => {
          onCambio(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setIndice(0);
          setAbierto(autoCompletar);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          setCursor(e.currentTarget.selectionStart ?? valor.length);
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) setAbierto(autoCompletar);
        }}
        onFocus={() => setAbierto(autoCompletar && valor.length > 0)}
        onBlur={() => setAbierto(false)}
        onScroll={(e) => {
          // Sin esto, con una consulta larga el espejo se queda quieto y el texto se desalinea.
          const espejo = espejoRef.current;
          if (espejo) espejo.scrollLeft = e.currentTarget.scrollLeft;
        }}
        placeholder=""
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={abierto}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "relative h-7 w-full border-0 bg-transparent px-2.5 py-1 outline-none",
          "text-transparent caret-gdb-fg selection:bg-gdb-accent/40",
          METRICA
        )}
      />

      {abierto && candidatos.length > 0 && (
        <div
          role="listbox"
          aria-label="Sugerencias de la consulta"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-[220] max-h-64 overflow-auto rounded-md border border-gdb-border bg-popover py-1 shadow-lg"
        >
          {candidatos.map((c, i) => (
            <button
              key={`${c.tipo}:${c.insercion}`}
              type="button"
              role="option"
              aria-selected={i === indiceActivo}
              onMouseDown={(e) => {
                // `mousedown` y no `click`: el blur del input cerraría el popup antes del click.
                e.preventDefault();
                aceptar(c);
              }}
              onMouseEnter={() => setIndice(i)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-[3px] text-left",
                i === indiceActivo ? "bg-gdb-hover" : "hover:bg-gdb-rowhover"
              )}
            >
              <span className="w-3 shrink-0 text-[9px] text-gdb-fgmuted">
                {c.tipo === "campo" ? "▪" : c.tipo === "operador" ? "$" : "ƒ"}
              </span>
              <span
                className={cn(
                  "shrink-0 font-jetbrains text-[11px]",
                  c.tipo === "campo" ? "text-gdb-fgstrong" : "text-gdb-const"
                )}
              >
                {c.etiqueta}
              </span>
              {c.detalle && (
                <span className="min-w-0 flex-1 truncate text-[10px] text-gdb-fgmuted">{c.detalle}</span>
              )}
              {c.sql && (
                <span className="shrink-0 rounded bg-gdb-field px-1 font-jetbrains text-[9px] text-gdb-fgmuted">
                  {c.sql}
                </span>
              )}
            </button>
          ))}
          <div className="px-2 pt-1 text-[9px] text-gdb-fgdim">
            ↑↓ elegir · ⏎ aceptar · ⎋ cerrar
          </div>
        </div>
      )}
    </div>
  );
}
