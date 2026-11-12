/**
 * Densidad (R10). Es un ajuste propio, independiente del tema.
 *
 * D1 (usuario, 2026-10-09): por defecto la de la New UI de JetBrains — `Tree.rowHeight` 24 y
 * `TabbedPane.tabHeight` 40 en expUI_dark/light.theme.json —; la clásica de Darcula (20 / 32,
 * research/datagrip-ux.md §5.4) queda como opción. La cabecera del grid es la fila + 5, igual que en
 * Darcula (`Table.rowHeight` 20 → `TableHeader.height` 25).
 */
export type DensityId = "newui" | "classic";

export interface DensityDef {
  id: DensityId;
  label: string;
  row: number;
  th: number;
  tab: number;
}

export const DENSITIES: Record<DensityId, DensityDef> = {
  newui: { id: "newui", label: "New UI (24 / 40)", row: 24, th: 29, tab: 40 },
  classic: { id: "classic", label: "Clásica (20 / 32)", row: 20, th: 25, tab: 32 },
};

export const DEFAULT_DENSITY: DensityId = "newui";

/** Métricas que no dependen del modo (research/datagrip-ux.md §5.4). */
export const FIXED_METRICS = { indent: 18, icon: 16 } as const;
