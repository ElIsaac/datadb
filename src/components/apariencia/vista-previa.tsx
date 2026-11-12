/**
 * R98 (T1) — vista previa en vivo del diálogo «Apariencia». Pinta con las variables CSS del tema
 * APLICADO (`var(--gdb-*)`): como todo cambio se aplica al instante, lo que se ve aquí es lo que ya
 * tiene la app, sin una segunda copia de los colores.
 *
 * El SQL se colorea con el MISMO lexer del editor (`highlightLines`, clases `ld-*`), así que la
 * muestra no puede discrepar del editor real.
 */
import * as React from "react";
import { highlightLines } from "@/components/own-editor/highlight";
import { DENSITIES } from "@/theme/density";
import { PALETTES, esPaletaActiva, paletaPorId } from "@/theme/palettes";
import { THEMES } from "@/theme/themes";
import { modoDe } from "@/theme/modo";
import { resolveTokens, type ThemeState } from "@/theme/apply";
import { bordesVerticales, coloresDeTipo, temaDeGrid } from "@/components/grid/grid-theme";
import { tokenDeColorPorTipo } from "@/components/grid/cell-model";
import { PESO_DE_TINTE, TINTE_DE_EJEMPLO, fondoTenido } from "@/lib/profile-colors";
import type { TokenKey } from "@/theme/tokens";

const SQL = [
  "SELECT d.id, d.amount, d.created_at",
  "FROM clients_deposits_clientdeposit d",
  "WHERE d.status = 'PENDING'",
  "  -- pendientes del día",
  "ORDER BY d.created_at DESC",
  "LIMIT 50;",
];

/** Columnas de la muestra con su tipo, para colorearlas con las reglas de la rejilla real. */
// Sin `id`: la columna de número de fila ya lo cubre y el panel es estrecho (con `id` la casilla quedaba
// cortada a la derecha).
const COLUMNAS = [
  { nombre: "amount", tipo: "decimal" },
  { nombre: "created_at", tipo: "date" },
  { nombre: "status", tipo: "varchar" },
  { nombre: "paid", tipo: "boolean" },
] as const;

const FILAS: Array<[string, string, string | null, boolean]> = [
  ["1250.00", "2026-10-21", "PENDING", false],
  ["980.50", "2026-10-21", "PAID", true],
  ["15000.00", "2026-10-21", null, false],
  ["320.75", "2026-10-22", "PAID", true],
];

/** La casilla como la dibuja glide: marcada = cuadro lleno del acento con la palomita del fondo. */
function Casilla({ marcada, acento, tenue, fondo }: { marcada: boolean; acento: string; tenue: string; fondo: string }) {
  return (
    <span
      className="inline-flex size-[10px] items-center justify-center rounded-[2px] align-middle"
      style={marcada ? { backgroundColor: acento } : { boxShadow: `inset 0 0 0 1px ${tenue}` }}
      data-casilla={marcada ? "marcada" : "vacia"}
    >
      {marcada && (
        <svg viewBox="0 0 10 10" className="size-[8px]" aria-hidden>
          <path d="M2 5.2 4.2 7.3 8 2.8" fill="none" stroke={fondo} strokeWidth="1.6" />
        </svg>
      )}
    </span>
  );
}

const NOMBRE_DE_MODO = { oscuro: "Oscuro", claro: "Claro", sistema: "Seguir al sistema" } as const;

export function VistaPrevia({
  state,
  conexion,
}: {
  state: ThemeState;
  /** La conexión de la consola con foco (`color` = el que tiñe, o `null`). */
  conexion?: { nombre: string; color: string | null } | null;
}) {
  const tinte = conexion?.color ?? TINTE_DE_EJEMPLO;
  const tokens = React.useMemo(() => highlightLines(SQL, "mysql"), []);
  const colores = resolveTokens(state);
  const rejilla = temaDeGrid((n) => colores[n.replace("--gdb-", "") as TokenKey], state.cuadricula);
  const verticales = bordesVerticales(state.cuadricula);
  /*
    Selección de muestra como la pinta glide: un RANGO (filas 2–3 × amount y created_at) con el relleno
    de selección (`accentLight`) y la celda con foco con el anillo del acento (`accentColor`). Antes
    la muestra pintaba una fila entera con `sel` y la rejilla real seleccionaba con el color de hover,
    así que no se parecían y cambiaban distinto de tema a tema.
  */
  const seleccion = (fila: number, col: number): React.CSSProperties => {
    const dentro = fila >= 1 && fila <= 2 && col <= 1;
    if (!dentro) return {};
    const foco = fila === 1 && col === 0;
    return {
      backgroundColor: rejilla.accentLight,
      ...(foco ? { boxShadow: `inset 0 0 0 1px ${rejilla.accentColor}` } : {}),
    };
  };
  const porTipo = coloresDeTipo((n) => colores[n.replace("--gdb-", "") as TokenKey]);
  /** Bordes de una celda como los pinta glide: línea abajo siempre, a la derecha si hay verticales. */
  const borde = (cabecera: boolean): React.CSSProperties => ({
    borderBottom: `1px solid ${rejilla.horizontalBorderColor}`,
    borderRight: verticales || cabecera ? `1px solid ${rejilla.borderColor}` : undefined,
  });
  const paleta = state.palette ? paletaPorId(state.palette) : undefined;
  // Sin paleta anotada (apariencia de fábrica) el nombre es el del tema FIEL que coincide, para que
  // diga «Darcula» como su tarjeta y no «Darcula (clásico)», que es el nombre del tema base.
  const fielActiva = PALETTES.find((p) => p.fiel && esPaletaActiva(state, p.id));
  const nombreTema = paleta?.label ?? fielActiva?.label ?? THEMES[state.base].label;
  // «Retocado» = el estado ya no es el tema tal cual (con paleta: ya no es la paleta limpia; sin
  // paleta: hay colores cambiados sobre el tema base).
  const retocado = paleta ? !esPaletaActiva(state, paleta.id) : Object.keys(state.over).length > 0;

  return (
    <aside className="flex min-h-0 flex-col gap-2 border-l border-gdb-sep bg-gdb-editor p-3" data-testid="apariencia-vista-previa">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold tracking-wide text-gdb-fgdim uppercase">Vista previa</span>
        <span className="truncate text-[11px] text-gdb-fg" data-testid="apariencia-tema-actual">
          {nombreTema}
        </span>
      </div>

      {/* Mini ventana: pestaña de consola + editor + rejilla. */}
      <div className="overflow-hidden rounded-md border border-gdb-sep bg-gdb-chrome">
        <div className="flex h-7 items-end border-b border-gdb-sep bg-gdb-tabsbg px-2">
          <span className="flex h-full items-center gap-1.5 bg-gdb-tabactive px-2 text-[11px] text-gdb-fg shadow-[inset_0_-2px_0_var(--gdb-accent)]">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: tinte }} />
            consola 1
          </span>
        </div>
        <pre className="m-0 bg-gdb-editor py-1.5 font-jetbrains text-[10.5px] leading-[16px] text-gdb-fgeditor">
          {SQL.map((linea, i) => {
            const partes: React.ReactNode[] = [];
            let cursor = 0;
            tokens[i].forEach((t, j) => {
              if (t.from > cursor) partes.push(linea.slice(cursor, t.from));
              partes.push(
                <span key={j} className={t.cls}>
                  {linea.slice(t.from, t.to)}
                </span>
              );
              cursor = t.to;
            });
            if (cursor < linea.length) partes.push(linea.slice(cursor));
            return (
              <div key={i} className="flex" style={i === 2 ? { backgroundColor: "var(--gdb-caretrow)" } : undefined}>
                <span className={i === 2 ? "w-6 shrink-0 pr-2 text-right text-gdb-linenocur" : "w-6 shrink-0 pr-2 text-right text-gdb-lineno"}>
                  {i + 1}
                </span>
                <span className="whitespace-pre">{partes}</span>
              </div>
            );
          })}
        </pre>
        {/*
          R98: la rejilla de la muestra se pinta con el MISMO tema que la rejilla real (`temaDeGrid`,
          con la cuadrícula elegida) y con las MISMAS reglas de celda (`tokenDeColorPorTipo`, casilla
          para los booleanos): si la real cambia, la muestra cambia con ella.
        */}
        <table
          className="w-full border-collapse font-jetbrains text-[10px] leading-[18px] whitespace-nowrap"
          style={{ backgroundColor: rejilla.bgCell, color: rejilla.textDark }}
          data-testid="vista-previa-rejilla"
        >
          <thead>
            <tr style={{ backgroundColor: rejilla.bgHeader, color: rejilla.textHeader }}>
              <th className="w-5 px-1 font-normal" style={borde(true)} />
              {COLUMNAS.map((c) => (
                <th key={c.nombre} className="px-1.5 text-left font-semibold" style={borde(true)}>
                  {c.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((f, i) => (
              <tr key={i}>
                <td className="px-1 text-right" style={{ ...borde(false), color: rejilla.textMedium }}>
                  {i + 1}
                </td>
                {COLUMNAS.map((c, j) => {
                  const v = f[j];
                  if (typeof v === "boolean") {
                    return (
                      <td key={c.nombre} className="px-1.5 text-center" style={{ ...borde(false), ...seleccion(i, j) }}>
                        <Casilla marcada={v} acento={colores.accent} tenue={colores.fgdim} fondo={rejilla.bgCell} />
                      </td>
                    );
                  }
                  const token = state.coloresPorTipo === false ? null : tokenDeColorPorTipo(c.tipo);
                  const color =
                    v === null ? rejilla.textLight : token ? porTipo[token] : undefined;
                  return (
                    <td
                      key={c.nombre}
                      className={c.tipo === "decimal" ? "px-1.5 text-right" : "px-1.5"}
                      style={{ ...borde(false), color, ...seleccion(i, j) }}
                    >
                      {v === null ? "[NULL]" : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {/*
          R18: el explorador teñido con el color de la conexión, EXACTAMENTE como en la app
          (`fondoTenido` sobre `--sidebar` con el mismo peso). Antes era una franja roja «producción»
          con un token de entorno que la app no usaba en ningún sitio (el usuario la buscó y no la
          encontró). Dice con qué conexión —o que es un ejemplo, si la de la consola no tiene color—.
        */}
        <div
          className="flex h-6 items-center gap-1.5 border-t border-gdb-sep px-2 text-[10.5px] text-gdb-fg"
          style={{ backgroundColor: fondoTenido(tinte, "var(--sidebar)", PESO_DE_TINTE.arbol) }}
          data-testid="vista-previa-conexion"
          data-tinte={tinte}
        >
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tinte }} />
          <span className="truncate">
            {conexion?.color ? (
              <>Explorador de «{conexion.nombre}»</>
            ) : (
              <>Ejemplo en rojo: {conexion ? `«${conexion.nombre}» no tiene color` : "sin conexión"} · se elige en Conexiones</>
            )}
          </span>
        </div>
      </div>

      {/* Lo que está en uso, en una lista corta (cada dato una vez). */}
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-gdb-fgdim">Tema</dt>
        <dd className="truncate text-gdb-fg">{nombreTema}</dd>
        <dt className="text-gdb-fgdim">Modo</dt>
        <dd className="text-gdb-fg">{NOMBRE_DE_MODO[modoDe(state)]}</dd>
        <dt className="text-gdb-fgdim">Densidad</dt>
        <dd className="text-gdb-fg">{DENSITIES[state.density].label}</dd>
        <dt className="text-gdb-fgdim">Colores</dt>
        <dd className="text-gdb-fg">{retocado ? "retocados a mano" : "los del tema"}</dd>
      </dl>
    </aside>
  );
}
