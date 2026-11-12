import { IjIcon } from "@/components/ij-icon";
import { cn } from "@/lib/utils";
import type { MotorDeConexion } from "@/shared/connection-net";

/*
  R96: sacado de `app-top-bar.tsx` para que la tool window «Consultas guardadas» pinte el MISMO logo
  de motor en sus grupos y en la vista previa (un solo sitio decide qué icono y qué color lleva
  cada motor).
*/

/**
 * Icono del MOTOR: la marca oficial para PostgreSQL y MySQL (`brand-icons.ts`) y el cilindro propio
 * teñido para SQL Server, que no tiene marca en Simple Icons. Sin motor conocido, el icono genérico
 * de base de datos.
 */
export function IconoMotor({ tipo, className }: { tipo?: MotorDeConexion; className?: string }) {
  if (tipo === "postgres") return <IjIcon name="postgres" className={cn("shrink-0 text-gdb-enginepg", className)} />;
  if (tipo === "mysql") return <IjIcon name="mysql" className={cn("shrink-0 text-gdb-enginemysql", className)} />;
  if (tipo === "sqlserver") return <IjIcon name="database" className={cn("shrink-0 text-gdb-enginemssql", className)} />;
  if (tipo === "mongodb") return <IjIcon name="mongodb" className={cn("shrink-0 text-gdb-enginemongo", className)} />;
  return <IjIcon name="database" className={cn("shrink-0 opacity-70", className)} />;
}

