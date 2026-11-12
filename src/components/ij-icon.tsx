/**
 * Icono de la New UI de IntelliJ (fase 8, R34). Reemplaza a `lucide-react` en el chrome y el árbol.
 *
 * - 16×16 (`size-4`), como en DataGrip: los iconos de `expui/` están dibujados para esa rejilla y escalarlos a tamaños
 *   no enteros los emborrona. Si una barra no cabe se ajusta su padding, no el icono (PLAN de la fase 8, riesgos).
 *   `size={32}` (×2 exacto, sigue nítido) solo para ilustraciones de estado vacío.
 * - Los colores NO vienen del `className` (`text-…` no tiene efecto): el SVG pinta con `var(--gdb-ic*)`, así que sigue
 *   el tema y la edición de la paleta (D3). Un icono "activo" o "peligroso" se marca en el botón que lo contiene.
 *   La excepción son las MARCAS de motor (`postgres`, `mysql`), que pintan con `currentColor`: ahí el `text-…` SÍ
 *   elige el color de identidad del motor (`text-gdb-enginepg`, `text-gdb-enginemysql`).
 * - Decorativo por defecto (`aria-hidden`): casi siempre va dentro de un botón con `title`/`aria-label`. Si el icono
 *   es el único portador de significado, pasar `label`.
 *
 * Los SVG salen de src/icons/intellij/generated.ts (generado y verificado por scripts/import-intellij-icons.ts) y de
 * src/icons/custom/custom-icons.ts (propios de T5, revisados por el usuario). Contenido estático del repo, nunca
 * entrada del usuario, por eso se inserta con dangerouslySetInnerHTML.
 */
import { IJ_ICONS, type IjIconName as IntelliJIjIconName } from "@/icons/intellij/generated";
import { CUSTOM_ICONS, type CustomIconName } from "@/icons/custom/custom-icons";
import { BRAND_ICONS, type BrandIconName } from "@/icons/custom/brand-icons";
import { cn } from "@/lib/utils";

/** Iconos importados de IntelliJ (Apache 2.0) + los propios de DataDB (T5; objetos de BD del plugin cerrado). */
export type IjIconName = IntelliJIjIconName | CustomIconName | BrandIconName;

const ICONS: Record<IjIconName, string> = { ...IJ_ICONS, ...CUSTOM_ICONS, ...BRAND_ICONS };

/**
 * SVG crudo de un icono, para quien pinta fuera de React.
 *
 * El popup de autocompletado de CodeMirror no es React: su render devuelve un `Node`. En vez de
 * duplicar los dibujos, se inyecta el MISMO SVG del catálogo (pinta con `var(--gdb-ic*)`, así que
 * sigue el tema igual que en el chrome).
 */
export function svgDeIcono(name: IjIconName): string {
  return ICONS[name] ?? "";
}

export function IjIcon({
  name,
  label,
  className,
  size = 16,
}: {
  name: IjIconName;
  label?: string;
  className?: string;
  size?: 16 | 32;
}) {
  return (
    <span
      data-ij-icon={name}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        // align-middle: dentro de un botón que no es flex el span quedaba en la línea base del texto, 2 px más arriba
        // (medido en el «+» de las filas del árbol y en la × de las pestañas de tabla). En contenedores flex no cambia nada.
        "inline-flex shrink-0 align-middle",
        size === 32 ? "size-8 [&>svg]:size-8" : "size-4 [&>svg]:size-4",
        className
      )}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
