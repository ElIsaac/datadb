import * as React from "react";
import { createPortal } from "react-dom";
import { parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getColumnKind } from "@/lib/column-kind";
import { CalendarIcon, ClockIcon, XIcon } from "lucide-react";
import { cellText } from "@/lib/cell-value";
import {
  MESES,
  aInstanteIso,
  aValorFecha,
  aValorFechaHora,
  conParte,
  diasDelMes,
  partesDeAhora,
  partesDeDate,
  partesDeTexto,
  partesDeValor,
  type ParteDeFecha,
  type PartesDeFecha,
} from "@/lib/fecha-partes";

interface EditableCellProps {
  value: unknown;
  columnType: string;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  /**
   * `true` cuando quien monta el editor YA es un panel flotante — el overlay del grid sobre
   * canvas. Entonces los selectores pintan su contenido en línea en vez de abrir un popover en un
   * portal: glide cierra su overlay ante cualquier clic fuera de su subárbol, y el contenido de un
   * portal está fuera, así que elegir un día desmontaba el editor entero sin confirmar nada.
   */
  enLinea?: boolean;
}

/* ─── helpers ─────────────────────────────────────────────── */

// `parseWallClock` se retiró con R95: el valor de reloj de pared lo descompone `partesDeValor`
// (`lib/fecha-partes.ts`), con la misma convención y con tests.

function parseInstant(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  let str = String(value).trim();
  if (!str) return undefined;
  str = str.replace(" ", "T");
  const d = parseISO(str);
  return isNaN(d.getTime()) ? undefined : d;
}

function timeToInputValue(value: unknown, hasSeconds: boolean): string {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  const match = /^(\d{2}:\d{2})(?::(\d{2}))?/.exec(str);
  if (!match) return "";
  return hasSeconds ? `${match[1]}:${match[2] ?? "00"}` : match[1];
}

function timeHasSeconds(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return /^\d{1,2}:\d{2}:\d{2}/.test(value.trim());
}

/* ─── barra estilizada ────────────────────────────────────── */

const barClass =
  "flex h-full w-full cursor-pointer items-center gap-1.5 " +
  "rounded-[min(var(--radius-md),10px)] " +
  "border border-input bg-input/30 px-2 text-left transition-colors duration-100 " +
  "hover:border-ring/60 hover:bg-input/50 " +
  "[color-scheme:dark]";

const pickerIconClass = "size-3.5 shrink-0 text-muted-foreground";
const pickerValueClass = "flex-1 truncate text-xs font-medium text-foreground";
const pickerNullClass = "text-xs font-normal italic text-muted-foreground/70";

/* ─── dropdown posicionado vía portal ─────────────────────── */

/**
 * Dropdown que se renderiza en un portal (document.body), anclado al
 * boundingRect del anchorRef.current, evitando los problemas de
 * interacción que tenía Popover (Base UI) con react-day-picker.
 */
function PortalDropdown({
  open,
  anchorRef,
  onClose,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const popupRef = React.useRef<HTMLDivElement>(null);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  // "bottom": el popup cuelga hacia abajo del anchor (comportamiento normal).
  // "top": no cabe abajo, se voltea hacia arriba.
  const [placement, setPlacement] = React.useState<"top" | "bottom">("bottom");

  // Calcular la posicion del anchor en un effect, no en el render.
  React.useLayoutEffect(() => {
    if (open && anchorRef.current) {
      setRect(anchorRef.current.getBoundingClientRect());
    }
  }, [open, anchorRef]);

  // Recalcular posicion al hacer resize/scroll de la VENTANA (no de cualquier
  // scroll interno, como el propio popup, para no reposicionar en cada click).
  React.useEffect(() => {
    if (!open) return;
    function update() {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    }
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  // Decidir si el popup cabe abajo o hay que voltearlo arriba: se mide DESPUÉS
  // de montar (con el contenido real, que varía entre DatePicker/DateTimePicker),
  // y se corrige en el mismo ciclo de layout (antes del paint) para no parpadear.
  React.useLayoutEffect(() => {
    if (!open || !rect || !popupRef.current) return;
    const popupHeight = popupRef.current.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const margin = 8;
    if (spaceBelow < popupHeight + margin && spaceAbove > spaceBelow) {
      setPlacement("top");
    } else {
      setPlacement("bottom");
    }
  }, [open, rect, children]);

  // Cerrar al clic fuera.
  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (popupRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    const timer = setTimeout(() => document.addEventListener("mousedown", onClick, true), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !rect) return null;

  const style: React.CSSProperties =
    placement === "top"
      ? { left: rect.left, bottom: window.innerHeight - rect.top + 2, minWidth: rect.width, maxHeight: rect.top - 8 }
      : { left: rect.left, top: rect.bottom + 2, minWidth: rect.width, maxHeight: window.innerHeight - rect.bottom - 8 };

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[200] overflow-auto rounded-lg border border-border/80 bg-popover p-2 shadow-lg"
      style={style}
      // Evita que el navegador mueva el foco en mousedown: react-day-picker
      // reacciona al cambio de foco reconstruyendo el DOM del día bajo el
      // cursor (re-render entre mousedown y mouseup), lo que hace que el
      // navegador no dispare "click" porque el target del mouseup difiere
      // del target del mousedown. Ver comentario largo en PortalDropdown.
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
}

/**
 * Dentro del overlay del grid sobre canvas, un desplegable en portal NO funciona: glide cierra su
 * overlay en cuanto detecta un clic fuera de su propio subárbol, y el contenido de un portal vive
 * fuera. Medido en la app: al elegir un día en el calendario desaparecían el calendario, el editor
 * y el botón «Aplicar» de golpe, sin confirmar nada.
 *
 * La solución no es pelearse con el cierre, es no anidar: **el overlay YA es el desplegable**. En
 * modo `enLinea` el selector pinta su contenido directamente, sin barra disparadora y sin portal.
 * En el grid DOM se mantiene el portal, que ahí sí es lo correcto.
 */
function ContenedorDeSelector({
  enLinea,
  open,
  anchorRef,
  onClose,
  children,
}: {
  enLinea: boolean;
  open: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (enLinea) {
    // Acotado y con scroll propio: el contenido en línea (calendario + hora + Aplicar) es MÁS ALTO
    // que la barra disparadora que sustituye, y glide ancla su overlay a la celda. Editando una
    // fila de la parte baja de la pantalla, el botón «Aplicar» se salía de la ventana — medido:
    // `elementFromPoint` sobre su centro devolvía null. Enter sigue aplicando aunque no se vea.
    return (
      <div className="max-h-[50vh] min-w-[240px] overflow-auto rounded-md border border-border bg-popover p-2 text-popover-foreground">
        {children}
      </div>
    );
  }
  return (
    <PortalDropdown open={open} anchorRef={anchorRef} onClose={onClose}>
      {children}
    </PortalDropdown>
  );
}

/* ─── Fecha partida (R95) ──────────────────────────────────── */

/** Clases de los campos de la tira: compactos, con el fondo de campo del tema. */
const campoParteClass =
  "h-7 min-w-0 rounded border border-input bg-gdb-field px-1.5 text-xs text-foreground " +
  "outline-none focus-visible:border-ring [color-scheme:dark]";

/**
 * R95 — el editor de fecha / fecha-hora como el de DataGrip: **la fecha partida**.
 *
 * Pedido del usuario (2026-10-21, con la captura de DataGrip al lado): «el calendario de DataGrip
 * no lo muestra todo, lo parte». En DataGrip, al editar un `datetime` se abre bajo la celda una
 * tira de campos — día ▾ · mes ▾ (por nombre) · año con flechas, y debajo hora · minuto · segundo
 * con flechas — y se cambia SOLO la parte que hace falta. El calendario de mes de antes (R93)
 * ocupaba media pantalla, se cortaba con el borde (iba en un contenedor de `max-h-[50vh]` con
 * scroll) y para cambiar la hora había que bajar hasta el campo de hora.
 *
 * Lo que se conserva de R93: el campo de TEXTO arriba, con el valor completo, que acepta lo
 * escrito (`04/07/2019 18:30`, `2019-07-04`…) y no aplica nada imposible (rojo y sin cerrar).
 *
 * Los desplegables son `<select>` NATIVOS a propósito: el menú lo pinta el sistema, fuera del DOM,
 * así que glide no lo ve como «clic fuera» y no cierra su overlay (lo que pasaba con los popover en
 * portal; ver `ContenedorDeSelector`). Las flechas de año, hora, minuto y segundo son las del
 * `<input type="number">` (y ↑/↓ del teclado).
 *
 * ⏎ aplica y ⎋ cancela estén donde estén el foco (un `keydown` en captura sobre la ventana, el
 * mismo contrato que tenía el selector de fecha-hora): pulsar fuera NO confirma (fase 11, D3).
 */
function SelectorDeFechaPartida({
  value,
  onChange,
  onCancel,
  kind,
  enLinea = false,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onCancel: () => void;
  kind: "date" | "datetime" | "datetimetz";
  enLinea?: boolean;
}) {
  const conHora = kind !== "date";
  const [partes, setPartes] = React.useState<PartesDeFecha | null>(() => {
    if (kind === "datetimetz") {
      const instante = parseInstant(value);
      return instante ? partesDeDate(instante) : null;
    }
    return partesDeValor(value);
  });
  /** Texto del campo de arriba: el valor sin la fracción (que se conserva en `partes`). */
  const textoDe = React.useCallback(
    (p: PartesDeFecha | null) => (p ? (conHora ? aValorFechaHora({ ...p, fraccion: "" }) : aValorFecha(p)) : ""),
    [conHora]
  );
  const [texto, setTexto] = React.useState(() => textoDe(partes));
  /** ¿El usuario escribió en el campo? Solo entonces se vuelve a leer al aplicar. */
  const [textoEditado, setTextoEditado] = React.useState(false);
  const [invalida, setInvalida] = React.useState(false);
  const [open, setOpen] = React.useState(true);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  /** Lo que se enseña en los campos: con la celda en NULL, «ahora» (sin aplicarse hasta tocarlo). */
  const vista = partes ?? partesDeAhora();

  const cambiarParte = (parte: ParteDeFecha, crudo: string) => {
    if (crudo.trim() === "") return; // borrar el número para reescribirlo no es un valor
    const siguiente = conParte(vista, parte, Number(crudo));
    setPartes(siguiente);
    setTexto(textoDe(siguiente));
    setTextoEditado(false);
    setInvalida(false);
  };

  const valorDe = React.useCallback(
    (p: PartesDeFecha) =>
      kind === "date" ? aValorFecha(p) : kind === "datetimetz" ? aInstanteIso(p) : aValorFechaHora(p),
    [kind]
  );

  /** Aplica; devuelve `false` si lo escrito no es una fecha válida (y entonces no cierra). */
  const aplicar = React.useCallback((): boolean => {
    let final = partes;
    if (textoEditado) {
      const leidas = partesDeTexto(texto, conHora, partes);
      if (!leidas) {
        setInvalida(true);
        return false;
      }
      final = leidas;
    }
    onChange(final ? valorDe(final) : null);
    return true;
  }, [partes, textoEditado, texto, conHora, onChange, valorDe]);

  React.useEffect(() => {
    if (!open) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (aplicar()) setOpen(false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", alPulsar, true);
    return () => window.removeEventListener("keydown", alPulsar, true);
  }, [open, aplicar, onCancel]);

  const dias = diasDelMes(vista.anio, vista.mes);

  return (
    <>
      {!enLinea && (
        <div ref={anchorRef} className={barClass}>
          <CalendarIcon className={pickerIconClass} />
          <span className={pickerValueClass}>
            {partes ? textoDe(partes) : <span className={pickerNullClass}>NULL</span>}
          </span>
        </div>
      )}
      <ContenedorDeSelector
        enLinea={enLinea}
        open={open}
        anchorRef={anchorRef}
        onClose={() => { onCancel(); setOpen(false); }}
      >
        <div className="flex w-[300px] flex-col gap-1.5" data-testid="fecha-partida">
          <Input
            autoFocus
            value={texto}
            placeholder={partes ? undefined : "NULL — escribe o elige abajo"}
            aria-label="Escribir la fecha"
            data-testid="fecha-escrita"
            className={`h-7 font-mono text-xs ${invalida ? "border-destructive" : ""}`}
            onChange={(ev) => {
              const escrito = ev.target.value;
              setTexto(escrito);
              setTextoEditado(true);
              // En vivo: si lo escrito ya es válido, los campos de abajo lo siguen.
              const leidas = partesDeTexto(escrito, conHora, partes);
              setInvalida(Boolean(escrito.trim()) && leidas === null);
              if (leidas) setPartes(leidas);
            }}
          />
          <div className="grid grid-cols-[64px_1fr_80px] gap-1.5">
            <select
              aria-label="Día"
              title="Día"
              data-testid="fecha-dia"
              className={campoParteClass}
              value={vista.dia}
              onChange={(e) => cambiarParte("dia", e.target.value)}
            >
              {Array.from({ length: dias }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              aria-label="Mes"
              title="Mes"
              data-testid="fecha-mes"
              className={campoParteClass}
              value={vista.mes}
              onChange={(e) => cambiarParte("mes", e.target.value)}
            >
              {MESES.map((nombre, i) => (
                <option key={nombre} value={i + 1}>
                  {nombre}
                </option>
              ))}
            </select>
            <input
              type="number"
              aria-label="Año"
              title="Año"
              data-testid="fecha-anio"
              min={1}
              max={9999}
              className={campoParteClass}
              value={vista.anio}
              onChange={(e) => cambiarParte("anio", e.target.value)}
            />
          </div>
          {conHora && (
            <div className="grid grid-cols-[64px_1fr_80px] gap-1.5">
              <input
                type="number"
                aria-label="Hora"
                title="Hora (0–23)"
                data-testid="fecha-hora"
                min={0}
                max={23}
                className={campoParteClass}
                value={vista.hora}
                onChange={(e) => cambiarParte("hora", e.target.value)}
              />
              <input
                type="number"
                aria-label="Minuto"
                title="Minuto"
                data-testid="fecha-minuto"
                min={0}
                max={59}
                className={campoParteClass}
                value={vista.minuto}
                onChange={(e) => cambiarParte("minuto", e.target.value)}
              />
              <input
                type="number"
                aria-label="Segundo"
                title="Segundo"
                data-testid="fecha-segundo"
                min={0}
                max={59}
                className={campoParteClass}
                value={vista.segundo}
                onChange={(e) => cambiarParte("segundo", e.target.value)}
              />
            </div>
          )}
          {kind === "datetimetz" && (
            <p className="text-[10px] text-muted-foreground">En tu hora local; se guarda en UTC (columna con zona).</p>
          )}
          <div className="flex items-center justify-between gap-2 border-t pt-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => { onChange(null); setOpen(false); }}
              title="Dejar la celda en NULL"
            >
              <XIcon className="mr-1 size-3" />
              NULL
            </Button>
            <span className="text-[10px] text-muted-foreground">⏎ aplica · ⎋ cancela</span>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => { if (aplicar()) setOpen(false); }}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </ContenedorDeSelector>
    </>
  );
}

/* ─── TimePicker (input nativo visible) ────────────────────── */

function TimePicker({
  value,
  onChange,
  onCancel,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onCancel: () => void;
}) {
  const hasSeconds = React.useMemo(() => timeHasSeconds(value), [value]);
  const initialValue = timeToInputValue(value, hasSeconds);
  const [draft, setDraft] = React.useState(initialValue);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className={`${barClass} relative`}>
      <ClockIcon className={pickerIconClass} />
      <input
        ref={ref}
        type="time"
        step={1}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (v) onChange(hasSeconds ? v : v.slice(0, 5));
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className="h-full w-full flex-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-foreground outline-none [color-scheme:dark]"
      />
      <Button
        size="icon-xs"
        variant="ghost"
        className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); onChange(null); }}
        title="NULL"
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

/* ─── EditableCell ─────────────────────────────────────────── */

export function EditableCell({ value, columnType, onCommit, onCancel, enLinea = false }: EditableCellProps) {
  const kind = getColumnKind(columnType);
  // El draft debe arrancar con el valor ya guardado en la celda, no vacío:
  // antes se perdía el dato existente en cuanto el usuario entraba en modo
  // edición (mostraba un input en blanco aunque la celda tuviera contenido).
  // Para boolean el <Select> espera el string "true"/"false" (o "" para NULL).
  const [draft, setDraft] = React.useState(() => {
    if (value === null || value === undefined) return "";
    if (kind === "boolean") return String(value === true || value === "true");
    // jsonb/arrays llegan como objeto: editar el JSON, no "[object Object]" (que además se guardaría tal cual).
    return cellText(value) ?? "";
  });

  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    // Solo enfocamos, sin seleccionar todo el texto: si seleccionáramos con
    // .select(), la primera tecla que el usuario presione reemplazaría el
    // valor completo en vez de insertarse en el punto donde hizo clic —
    // justo el bug reportado ("escribo y borra lo que ya estaba"). Colocamos
    // el cursor al final del valor existente para poder seguir editándolo.
    const el = ref.current;
    if (!el) return;
    el.focus();
    // setSelectionRange no es soportado en <input type="number"> en Chrome
    // (lanza InvalidStateError) — solo aplica al posicionar cursor en texto.
    try {
      const len = el.value.length;
      el.setSelectionRange(len, len);
    } catch {
      // no-op: inputs numéricos ya quedan con el cursor al final por defecto
    }
  }, []);

  /**
   * Fase 11 (D3): UNA confirmación por edición.
   *
   * El input confirma con Enter y también al perder el foco, y dentro del overlay del grid sobre
   * canvas el blur llega antes del desmontaje: medido en el spike de la fase 10, una pulsación de
   * Enter producía DOS `onCommit` y dos escrituras. Con el mismo valor es inocuo, pero enganchado a
   * la base serían dos UPDATE.
   *
   * Se conserva el confirmar-al-salir (pinchar en otra celda guarda, que es lo que hace DataGrip);
   * lo que se quita es que pueda ocurrir dos veces.
   */
  const yaConfirmado = React.useRef(false);
  const commit = React.useCallback(() => {
    if (yaConfirmado.current) return;
    yaConfirmado.current = true;
    if (kind === "boolean") {
      if (draft === "") onCommit(null);
      else onCommit(draft === "true");
    } else if (kind === "number") {
      const num = draft === "" ? null : Number(draft);
      onCommit(num);
    } else {
      onCommit(draft === "" ? null : draft);
    }
  }, [draft, kind, onCommit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  if (kind === "boolean") {
    return (
      <Select
        value={draft}
        onValueChange={(v) => {
          const value = v ?? "";
          setDraft(value);
          onCommit(value === "" ? null : value === "true");
        }}
      >
        <SelectTrigger className="h-6 w-full border-0 bg-transparent px-1 py-0 text-xs shadow-none focus:ring-0">
          <SelectValue placeholder="NULL" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
          <SelectItem value="">NULL</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (kind === "date" || kind === "datetime" || kind === "datetimetz") {
    return <SelectorDeFechaPartida value={value} onChange={onCommit} onCancel={onCancel} kind={kind} enLinea={enLinea} />;
  }

  if (kind === "time") {
    return <TimePicker value={value} onChange={onCommit} onCancel={onCancel} />;
  }

  const inputType = kind === "number" ? "number" : "text";
  return (
    <Input
      ref={ref}
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className="h-full w-full rounded-none border-0 bg-transparent px-1 py-0 text-xs shadow-none focus-visible:ring-0"
    />
  );
}