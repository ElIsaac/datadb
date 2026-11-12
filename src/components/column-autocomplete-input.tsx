import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ColumnMeta } from "@/lib/types";

interface ColumnAutocompleteInputProps {
  columns: ColumnMeta[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Fase 13 (T5): aplicar con `Enter`. Sin esto, escribir un `WHERE` obligaba a soltar el teclado e
   * ir al botón «Ejecutar» — que es justo lo que DataGrip no hace.
   */
  onAplicar?: () => void;
  /** Volver al último valor aplicado (Escape). */
  onRevertir?: () => void;
  /**
   * Valores ya aplicados, del más reciente al más viejo: las flechas ↑/↓ recorren el historial,
   * como en DataGrip. Los pone el contenedor, que es quien sabe qué llegó a ejecutarse.
   */
  historial?: readonly string[];
  /** Se pinta el borde en rojo cuando lo aplicado dio error. El texto lo pone el contenedor. */
  invalido?: boolean;
}

/**
 * Input de una condición escrita a mano (`WHERE`, `ORDER BY`) con autocompletado de columnas.
 *
 * El autocompletado es el `<datalist>` nativo, que ya estaba: sugiere los nombres de columna sin
 * traer una librería de sugerencias y sin competir con el teclado (a diferencia de un popover, no
 * intercepta Enter ni las flechas).
 */
export function ColumnAutocompleteInput({
  columns,
  value,
  onChange,
  placeholder,
  onAplicar,
  onRevertir,
  historial = [],
  invalido = false,
}: ColumnAutocompleteInputProps) {
  const id = React.useId();
  /**
   * Posición en el historial. `-1` = lo que el usuario está escribiendo (fuera del historial), que es
   * el estado natural: en cuanto teclea, deja de recorrer.
   */
  const [indice, setIndice] = React.useState(-1);

  function alPulsarTecla(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onAplicar?.();
      return;
    }
    if (e.key === "Escape") {
      // No se deja pasar al grid: Escape dentro de la rejilla cierra editores y limpia selección.
      e.preventDefault();
      e.stopPropagation();
      setIndice(-1);
      onRevertir?.();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (historial.length === 0) return;
      e.preventDefault();
      /*
       * Al subir, si lo que hay escrito ES una entrada del historial, se arranca desde ella: si no,
       * la primera pulsación devolvería ese mismo texto y parecería que la flecha no hace nada (es lo
       * que pasó en la sonda: acabas de aplicar el filtro y lo tienes en el campo).
       */
      const desde =
        e.key === "ArrowUp" && indice === -1 ? Math.max(historial.indexOf(value), -1) : indice;
      const siguiente = e.key === "ArrowUp" ? desde + 1 : desde - 1;
      if (siguiente < -1 || siguiente >= historial.length) return;
      setIndice(siguiente);
      onChange(siguiente === -1 ? "" : historial[siguiente]);
    }
  }

  return (
    <div className="flex-1">
      <Input
        list={id}
        value={value}
        onChange={(e) => {
          setIndice(-1);
          onChange(e.target.value);
        }}
        onKeyDown={alPulsarTecla}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={invalido}
        className={cn("h-7 font-mono text-xs", invalido && "border-destructive")}
      />
      <datalist id={id}>
        {columns.map((col) => (
          <option key={col.name} value={col.name} />
        ))}
      </datalist>
    </div>
  );
}
