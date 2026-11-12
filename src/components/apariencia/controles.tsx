/**
 * R98 — controles compartidos del diálogo «Apariencia» (fila con etiqueta, segmentado). Un solo sitio
 * para su aspecto: hover real, el activo con fondo de acento y el foco de teclado visible.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** Segmentado (2–4 opciones fijas). Es un `radiogroup`: ←/→ no, pero Tab + Espacio sí. */
export function Segmentado<T extends string>({
  value,
  options,
  onChange,
  label,
  testid,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  testid?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testid}
      className="inline-flex h-7 overflow-hidden rounded-md border border-gdb-border"
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          data-valor={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "px-3 text-xs whitespace-nowrap transition-colors focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-gdb-focus",
            i > 0 && "border-l border-gdb-border",
            value === o.id
              ? "bg-gdb-btnprimary text-gdb-onaccent"
              : "text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Fila «etiqueta · control» de una sección (etiqueta a 140 px, como el panel de DataGrip). */
export function Fila({ etiqueta, children, ayuda }: { etiqueta: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 py-1.5">
      <span className="text-xs text-gdb-fgdim" title={ayuda}>
        {etiqueta}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Título de bloque dentro de una sección. */
export function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-[10.5px] font-semibold tracking-wide text-gdb-fgdim uppercase">{titulo}</h3>
      {children}
    </section>
  );
}
