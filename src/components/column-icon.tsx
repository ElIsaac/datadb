/**
 * Icono de columna con las insignias de DataGrip superpuestas (fase 8, T5; R34).
 *
 * DataGrip NO usa un icono distinto por combinación de claves: pinta el icono de columna y le superpone
 * pequeñas insignias en la esquina inferior derecha (PK, FK, índice, NOT NULL) — `research/datagrip-ux.md`
 * §2.1: «Combinaciones de icono en columnas (badges superpuestos, no iconos distintos)». Aquí se replica con
 * los iconos propios de T5, que ya vienen dibujados en el cuadrante inferior-derecho del viewBox.
 *
 * - PK y FK a la vez: la llave se queda abajo-derecha (es la más importante) y el eslabón se espeja a
 *   abajo-izquierda con `-scale-x-100`, como en la hoja de contacto aprobada (T5).
 * - Índice y NOT NULL quedan pendientes: el modelo de columnas aún no los expone al árbol (fase 20).
 */
import { IjIcon } from "@/components/ij-icon";
import { cn } from "@/lib/utils";

export function ColumnIcon({
  primaryKey,
  foreignKey,
  className,
}: {
  primaryKey?: boolean;
  foreignKey?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      <IjIcon name="column" />
      {primaryKey && <IjIcon name="primaryKey" className="absolute inset-0" />}
      {foreignKey && (
        <IjIcon
          name="foreignKey"
          className={cn("absolute inset-0", primaryKey && "-scale-x-100")}
        />
      )}
    </span>
  );
}
