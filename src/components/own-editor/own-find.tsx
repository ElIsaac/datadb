import * as React from "react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import {
  DEFAULT_FIND_OPTIONS,
  createQuery,
  findAll,
  nextIndex,
  replacementChanges,
  type FindOptions,
  type MatchRange,
} from "@/lib/find";
import { expandReplacement } from "@/lib/find";
import type { EditorModel, EditorSnapshot } from "@/lib/editor-core/model";

/**
 * La barra de buscar/reemplazar del editor PROPIO.
 *
 * Es la misma pieza visual que la del editor de CodeMirror (mismo sitio, mismas teclas, mismos
 * toggles) pero habla con el modelo (`EditorModel`) en vez de con un `EditorView`. Se mantiene
 * separada a propósito: el motor de búsqueda (`@/lib/editor-find`) es común y está probado, y la
 * barra de CodeMirror se borrará el día que la consola use este editor — no al revés.
 *
 * El motor es el mismo `SearchQuery` de CodeMirror: mayúsculas, palabra completa, regex y saltos
 * de línea funcionan igual que en el editor viejo, sin arrastrar su vista.
 */

export interface OwnFindBarHandle {
  next: () => void;
  previous: () => void;
  focus: () => void;
}

export interface OwnFindBarProps {
  model: EditorModel;
  open: boolean;
  replaceMode: boolean;
  /** Sube con cada cambio del documento: obliga a recontar mientras se teclea. */
  docVersion: number;
  onModeChange: (replace: boolean) => void;
  onClose: () => void;
  /** Emite el texto nuevo al padre (el camino normal de `onChange`). */
  onCommit: (snapshot: EditorSnapshot) => void;
  /** Solo repinta (mover la selección no cambia el texto). */
  onRender: () => void;
  /** Publica las coincidencias para que el editor las pinte todas. */
  onMatches: (matches: readonly MatchRange[]) => void;
}

const MATCH_LIMIT = 999;
const REPLACE_ALL_LIMIT = 20_000;

export const OwnFindBar = React.forwardRef<OwnFindBarHandle, OwnFindBarProps>(function OwnFindBar(
  { model, open, replaceMode, docVersion, onModeChange, onClose, onCommit, onRender, onMatches },
  ref
) {
  const [needle, setNeedle] = React.useState("");
  const [replacement, setReplacement] = React.useState("");
  const [options, setOptions] = React.useState<FindOptions>(DEFAULT_FIND_OPTIONS);
  const [index, setIndex] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const replaceRef = React.useRef<HTMLInputElement>(null);

  const query = React.useMemo(() => createQuery(needle, options), [needle, options]);
  const matches = React.useMemo<MatchRange[]>(
    () => (open && query.ok ? findAll(model.text, query.query, MATCH_LIMIT) : []),
    // `docVersion` es la dependencia que recontar; el linter no puede saberlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, query, model, docVersion]
  );

  const current = matches.length ? Math.min(index, matches.length - 1) : -1;

  // Al abrir: la selección de una línea se trae al campo, como DataGrip.
  React.useEffect(() => {
    if (!open) return;
    const sel = model.selection;
    const from = Math.min(sel.anchor, sel.head);
    const to = Math.max(sel.anchor, sel.head);
    const selected = model.text.slice(from, to);
    if (selected && !selected.includes("\n") && selected.length <= 200) setNeedle(selected);
    setIndex(0);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, model]);

  React.useEffect(() => {
    setIndex(0);
  }, [needle, options]);

  // Publica las coincidencias y selecciona la actual. El foco se queda en el campo de la barra.
  React.useEffect(() => {
    if (!open) {
      onMatches([]);
      return;
    }
    onMatches(matches);
    if (current >= 0) {
      const target = matches[current];
      model.setSelection({ anchor: target.from, head: target.to });
      onRender();
    }
    // `onMatches`/`onRender`/`model` son estables; `matches` y `current` mandan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matches, current]);

  React.useEffect(() => {
    if (!open || !replaceMode) return;
    const frame = requestAnimationFrame(() => replaceRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, replaceMode]);

  const go = React.useCallback(
    (delta: number) => {
      if (!matches.length) return;
      const next = nextIndex(current, matches.length, delta);
      setIndex(next);
      model.setSelection({ anchor: matches[next].from, head: matches[next].to });
      onRender();
    },
    [matches, current, model, onRender]
  );

  const close = React.useCallback(() => {
    onMatches([]);
    onClose();
  }, [onMatches, onClose]);

  const replaceOne = React.useCallback(() => {
    if (!query.ok || !matches[current]) return;
    const target = matches[current];
    const insert = expandReplacement(replacement, target.match);
    onCommit(model.insertAt(target.from, target.to, insert, "delete"));
  }, [query, matches, current, replacement, model, onCommit]);

  const replaceAll = React.useCallback(() => {
    if (!query.ok) return;
    const all = findAll(model.text, query.query, REPLACE_ALL_LIMIT);
    if (!all.length) return;
    onCommit(model.applyRanges(replacementChanges(all, replacement)));
  }, [query, model, replacement, onCommit]);

  React.useImperativeHandle(
    ref,
    () => ({ next: () => go(1), previous: () => go(-1), focus: () => inputRef.current?.focus() }),
    [go]
  );

  if (!open) return null;

  const invalida = query.ok === false && query.reason === "invalid";
  const contador = invalida
    ? "regex no válida"
    : !needle
      ? ""
      : matches.length
        ? `${current + 1} de ${matches.length}${matches.length >= MATCH_LIMIT ? "+" : ""}`
        : "sin coincidencias";

  const toggle = (key: keyof FindOptions) => setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  const sinRobarFoco = (e: React.MouseEvent) => e.preventDefault();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey && replaceMode) replaceAll();
      else if (e.shiftKey) go(-1);
      else go(1);
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      e.stopPropagation();
      onModeChange(true);
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      e.stopPropagation();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const botonToggle = (activo: boolean) =>
    [
      "inline-flex h-5 min-w-[20px] items-center justify-center rounded-[3px] px-1 text-[10px] font-semibold leading-none",
      activo ? "bg-gdb-listsel text-gdb-fgstrong" : "text-gdb-fg/70 hover:bg-gdb-hover hover:text-gdb-fg",
    ].join(" ");

  const botonIcono =
    "inline-flex h-5 w-5 items-center justify-center rounded-[3px] text-gdb-fg/60 hover:bg-gdb-hover hover:text-gdb-fg disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      data-testid="editor-find-bar"
      className="absolute right-2 top-1 z-30 flex w-[440px] max-w-[calc(100%-1rem)] flex-col gap-1 rounded-sm border border-gdb-borderstrong bg-gdb-chrome p-1 font-sans text-xs text-gdb-fg shadow-md"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-0.5">
        <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[3px] px-1.5 focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-gdb-focus">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-gdb-fg/50" aria-hidden />
          <input
            ref={inputRef}
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="Buscar"
            spellCheck={false}
            autoComplete="off"
            aria-label="Buscar"
            aria-invalid={invalida}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-gdb-fg outline-none placeholder:text-gdb-fg/35"
          />
        </div>

        <span
          className={[
            "min-w-[56px] text-right text-[11px] tabular-nums",
            matches.length || !needle ? "text-gdb-fg/50" : "text-destructive",
          ].join(" ")}
          aria-live="polite"
        >
          {contador}
        </span>

        <button type="button" className={botonIcono} onMouseDown={sinRobarFoco} onClick={() => go(-1)} disabled={!matches.length} aria-label="Coincidencia anterior" title="Anterior (⇧⏎)">
          <ChevronUpIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={botonIcono} onMouseDown={sinRobarFoco} onClick={() => go(1)} disabled={!matches.length} aria-label="Coincidencia siguiente" title="Siguiente (⏎)">
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>

        <span className="mx-0.5 h-3.5 w-px bg-gdb-sep/70" aria-hidden />

        <button type="button" className={botonToggle(options.caseSensitive)} onMouseDown={sinRobarFoco} onClick={() => toggle("caseSensitive")} aria-pressed={options.caseSensitive} aria-label="Distinguir mayúsculas" title="Distinguir mayúsculas">
          Aa
        </button>
        <button type="button" className={botonToggle(options.wholeWord)} onMouseDown={sinRobarFoco} onClick={() => toggle("wholeWord")} aria-pressed={options.wholeWord} aria-label="Palabra completa" title="Palabra completa" disabled={options.regex}>
          ab
        </button>
        <button type="button" className={botonToggle(options.regex)} onMouseDown={sinRobarFoco} onClick={() => toggle("regex")} aria-pressed={options.regex} aria-label="Expresión regular" title="Expresión regular">
          .*
        </button>

        <span className="mx-0.5 h-3.5 w-px bg-gdb-sep/70" aria-hidden />

        <button
          type="button"
          className={botonToggle(replaceMode)}
          onMouseDown={sinRobarFoco}
          onClick={() => onModeChange(!replaceMode)}
          aria-pressed={replaceMode}
          aria-label="Mostrar reemplazo"
          title="Reemplazar (⌘R)"
        >
          ⇄
        </button>
        <button type="button" className={botonIcono} onMouseDown={sinRobarFoco} onClick={close} aria-label="Cerrar" title="Cerrar (⎋)">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {replaceMode && (
        <div className="flex items-center gap-0.5">
          <span className="w-[18px] shrink-0" aria-hidden />
          <div className="flex h-6 min-w-0 flex-1 items-center rounded-[3px] px-1.5 focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-gdb-focus">
            <input
              ref={replaceRef}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Reemplazar"
              spellCheck={false}
              autoComplete="off"
              aria-label="Reemplazar"
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-gdb-fg outline-none placeholder:text-gdb-fg/35"
            />
          </div>
          <button
            type="button"
            className="h-6 rounded-[3px] px-1.5 text-[11px] text-gdb-fg/75 hover:bg-gdb-hover hover:text-gdb-fg disabled:opacity-40 disabled:hover:bg-transparent"
            onMouseDown={sinRobarFoco}
            onClick={replaceOne}
            disabled={!matches.length}
            title="Reemplazar la coincidencia actual"
          >
            Reemplazar
          </button>
          <button
            type="button"
            className="h-6 rounded-[3px] px-1.5 text-[11px] text-gdb-fg/75 hover:bg-gdb-hover hover:text-gdb-fg disabled:opacity-40 disabled:hover:bg-transparent"
            onMouseDown={sinRobarFoco}
            onClick={replaceAll}
            disabled={!matches.length}
            title="Reemplazar todo (⌘⏎)"
          >
            Todo
          </button>
        </div>
      )}
    </div>
  );
});
