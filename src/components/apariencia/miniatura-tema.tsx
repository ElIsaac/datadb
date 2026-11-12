/**
 * R98 (T1) — miniatura de un tema para la galería: una ventana de DataDB en pequeño pintada con los
 * colores RESUELTOS del tema (`tokensResueltosDePaleta`), no con los del tema activo. Así cada
 * tarjeta se ve como quedará la app al elegirla.
 *
 * Las líneas de SQL y de la rejilla son barras de color (no texto): a este tamaño el texto sería
 * ilegible y solo ensuciaría; lo que se reconoce de un tema es su combinación de colores.
 */
import * as React from "react";
import type { TokenKey } from "@/theme/tokens";

type Colores = Record<TokenKey, string>;

/** Una barra de «texto» de la miniatura. */
function Barra({ color, ancho }: { color: string; ancho: number }) {
  return <span className="h-[3px] shrink-0 rounded-full" style={{ backgroundColor: color, width: ancho }} />;
}

export function MiniaturaTema({ t }: { t: Colores }) {
  return (
    <div
      className="flex h-[88px] w-full flex-col overflow-hidden rounded-[5px]"
      style={{ backgroundColor: t.chrome, boxShadow: `inset 0 0 0 1px ${t.sep}` }}
      aria-hidden
    >
      {/* Barra superior con una pestaña activa (subrayado de acento). */}
      <div className="flex h-[12px] shrink-0 items-end gap-1 px-1.5" style={{ borderBottom: `1px solid ${t.sep}` }}>
        <span className="mb-[3px] size-[5px] rounded-full" style={{ backgroundColor: t.envprod }} />
        <span className="flex h-full items-center px-1" style={{ boxShadow: `inset 0 -2px 0 ${t.accent}` }}>
          <Barra color={t.fg} ancho={14} />
        </span>
        <span className="flex h-full items-center px-1">
          <Barra color={t.fgdim} ancho={10} />
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Barra lateral: árbol con 3 filas (la segunda, seleccionada). */}
        <div className="flex w-[30%] shrink-0 flex-col gap-[3px] py-1.5" style={{ borderRight: `1px solid ${t.sep}` }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="flex h-[7px] items-center gap-1 px-1.5"
              style={{ backgroundColor: i === 1 ? t.listsel : undefined }}
            >
              <span className="size-[4px] shrink-0 rounded-[1px]" style={{ backgroundColor: i === 0 ? t.icodb : t.icotbl }} />
              <Barra color={i === 1 ? t.fgstrong : t.fg} ancho={[18, 14, 16][i]} />
            </span>
          ))}
        </div>
        {/* Editor (3 líneas de SQL coloreado) + rejilla (cabecera y 2 filas). */}
        <div className="flex min-w-0 flex-1 flex-col" style={{ backgroundColor: t.editor }}>
          <div className="flex flex-col gap-[4px] px-1.5 py-1.5">
            <span className="flex items-center gap-[3px]">
              <Barra color={t.lineno} ancho={3} />
              <Barra color={t.kw} ancho={13} />
              <Barra color={t.fgeditor} ancho={9} />
              <Barra color={t.fn} ancho={11} />
            </span>
            <span className="flex items-center gap-[3px]" style={{ backgroundColor: t.caretrow }}>
              <Barra color={t.lineno} ancho={3} />
              <Barra color={t.kw} ancho={9} />
              <Barra color={t.fgeditor} ancho={16} />
            </span>
            <span className="flex items-center gap-[3px]">
              <Barra color={t.lineno} ancho={3} />
              <Barra color={t.kw} ancho={10} />
              <Barra color={t.str} ancho={14} />
              <Barra color={t.comment} ancho={8} />
            </span>
          </div>
          <div className="mt-auto" style={{ borderTop: `1px solid ${t.grid}` }}>
            <div className="flex h-[8px] items-center gap-2 px-1.5" style={{ backgroundColor: t.th }}>
              <Barra color={t.fgdim} ancho={8} />
              <Barra color={t.fgdim} ancho={12} />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="flex h-[8px] items-center gap-2 px-1.5" style={{ borderTop: `1px solid ${t.grid}` }}>
                <Barra color={t.num} ancho={8} />
                <Barra color={i === 0 ? t.fgeditor : t.muted} ancho={12} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
