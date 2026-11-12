import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  useReactFlow,
  MarkerType,
  useNodesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { useThemeTokens } from "@/theme/theme-store";
import { Button } from "@/components/ui/button";
import { useAppState, useAppDispatch } from "@/hooks/use-app-state";
import type { SchemaNode, TableTab } from "@/lib/types";
import {
  buildDirectErGraph,
  buildErGraphForTables,
  getDirectNeighbors,
  layoutErGraph,
  estimateNodeHeight,
  ER_NODE_WIDTH,
  type ErNode,
  type ErEdge,
} from "@/lib/er-graph";
import {
  KeyIcon,
  LinkIcon,
  PlusIcon,
  RefreshCwIcon,
  DownloadIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MaximizeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nodeTypes: NodeTypes = {
  table: TableNode,
};

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

interface TableRef {
  schema: string;
  table: string;
}

/**
 * Datos que recibe cada nodo-tabla: el ErNode + callbacks y estado de
 * inclusión para la expansión interactiva (click en FK → agregar la tabla
 * referenciada al diagrama).
 */
type TableNodeData = ErNode & {
  /** Keys "schema.tabla" ya presentes en el diagrama. */
  includedKeys: Set<string>;
  /** Keys del conjunto base (para saber qué NO se puede quitar en modo scope). */
  baseKeys?: Set<string>;
  /** Key de la tabla raíz (modo shortcut); null en diagramas de consulta. */
  rootKey?: string | null;
  /** true si el nodo tiene vecinos FK que aún no están en el diagrama. */
  hasMoreNeighbors: boolean;
  onExpandFk: (fromKey: string, ref: TableRef) => void;
  onRemoveFk?: (ref: TableRef) => void;
  onExpandAll: (fromKey: string, fromRef: TableRef) => void;
};

function TableNode({ data }: NodeProps) {
  const nodeData = data as TableNodeData;
  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-card text-xs shadow-sm"
      style={{ width: ER_NODE_WIDTH }}
    >
      <div className="flex items-center gap-1 border-b border-border bg-primary px-2.5 py-1.5 font-semibold text-primary-foreground">
        <span className="truncate">{nodeData.table}</span>
        {nodeData.hasMoreNeighbors && (
          <button
            type="button"
            // "nodrag" evita que xyflow inicie un drag del nodo al presionar el botón.
            className="nodrag ml-auto shrink-0 rounded p-0.5 hover:bg-primary-foreground/20"
            title="Agregar todas las tablas relacionadas faltantes"
            onClick={(e) => {
              e.stopPropagation();
              nodeData.onExpandAll(nodeData.id, {
                schema: nodeData.schema,
                table: nodeData.table,
              });
            }}
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>
      <div className="py-1">
        {nodeData.columns.map((col) => {
          const fkTargetKey = col.fk
            ? tableKey(col.fk.schema || nodeData.schema, col.fk.table)
            : null;
          const fkIncluded = fkTargetKey
            ? nodeData.includedKeys.has(fkTargetKey)
            : false;
          // La raíz nunca se puede quitar; en modo scope las tabs base
          // tampoco. Todo lo demás se quita con click en su FK (junto con
          // las tablas que colgaron de ella — ver handleRemoveFk).
          // Los `?.` blindan contra `data` de una versión anterior que
          // sobrevive al Fast Refresh de Next (nodos ya montados sin estos
          // campos): en ese caso la FK se muestra como icono plano.
          const fkRemovable =
            fkTargetKey && nodeData.onRemoveFk
              ? nodeData.rootKey
                ? fkTargetKey !== nodeData.rootKey
                : !(nodeData.baseKeys?.has(fkTargetKey) ?? true)
              : false;
          return (
            <div
              key={col.name}
              // "relative" ancla los handles de esta fila: xyflow mide su
              // posición real en el DOM y dibuja el edge exactamente a la
              // altura de la columna FK (sin handles, un nodo custom no
              // renderiza edges en absoluto — ese era el bug de las líneas).
              className="relative flex items-center gap-1.5 px-2.5 py-0.5 text-muted-foreground"
            >
              <Handle
                type="target"
                id={`t-${col.name}`}
                position={Position.Left}
                className="!size-1.5 !border-0 !bg-transparent !opacity-0"
              />
              <Handle
                type="source"
                id={`s-${col.name}`}
                position={Position.Right}
                className="!size-1.5 !border-0 !bg-transparent !opacity-0"
              />
              <span className="truncate text-foreground">{col.name}</span>
              <span className="text-[10px] opacity-60">{col.type}</span>
              {col.isPrimaryKey && (
                <KeyIcon
                  className={cn(
                    "size-3 shrink-0 text-gdb-icokey",
                    !col.fk && "ml-auto"
                  )}
                />
              )}
              {col.fk &&
                (!fkIncluded ? (
                  <button
                    type="button"
                    className="nodrag ml-auto shrink-0 rounded p-0.5 hover:bg-muted"
                    title={`Agregar ${col.fk.schema || nodeData.schema}.${col.fk.table} al diagrama`}
                    onClick={(e) => {
                      e.stopPropagation();
                      nodeData.onExpandFk(nodeData.id, {
                        schema: col.fk!.schema || nodeData.schema,
                        table: col.fk!.table,
                      });
                    }}
                  >
                    <LinkIcon className="size-3 shrink-0 text-gdb-link" />
                  </button>
                ) : fkRemovable ? (
                  <button
                    type="button"
                    // "group" para intercambiar el icono link → X roja en hover.
                    className="nodrag group ml-auto shrink-0 rounded p-0.5 hover:bg-gdb-fail/10"
                    title={`Quitar ${fkTargetKey} del diagrama (y las tablas que cuelguen de ella)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      nodeData.onRemoveFk?.({
                        schema: col.fk!.schema || nodeData.schema,
                        table: col.fk!.table,
                      });
                    }}
                  >
                    <LinkIcon className="size-3 shrink-0 text-gdb-link group-hover:hidden" />
                    <XIcon className="hidden size-3 shrink-0 text-gdb-fail group-hover:block" />
                  </button>
                ) : (
                  <LinkIcon className="ml-auto size-3 shrink-0 text-gdb-link" />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  );
}

const EXPAND_GAP_X = 200;
const EXPAND_GAP_Y = 24;

/**
 * Tras quitar una tabla, elimina de la lista de extras las que hayan quedado
 * desconectadas del conjunto base ("las demás que le siguen"): se arma el
 * grafo solo con las tablas restantes y se hace BFS desde las anclas (las
 * tablas base que quedan). Una tabla alcanzable por OTRO camino FK sobrevive
 * — no se quita si el usuario la puede seguir alcanzando desde otra FK.
 */
function pruneOrphanExtras(
  schemaNodes: SchemaNode[],
  anchors: TableRef[],
  extras: TableRef[]
): TableRef[] {
  if (extras.length === 0) return extras;
  if (anchors.length === 0) return [];
  const { edges } = buildErGraphForTables(schemaNodes, [...anchors, ...extras]);
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    const a = tableKey(e.from.schema, e.from.table);
    const b = tableKey(e.to.schema, e.to.table);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  const visited = new Set(anchors.map((r) => tableKey(r.schema, r.table)));
  const queue = [...visited];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return extras.filter((r) => visited.has(tableKey(r.schema, r.table)));
}

/**
 * Coloca los nodos recién agregados por expansión junto al nodo desde el que
 * se expandieron: a la izquierda si el nuevo tiene la FK hacia un existente
 * (la flecha sale del nuevo), a la derecha si es referenciado por uno
 * existente. Baja en cascada hasta encontrar un hueco sin solapamientos.
 * Los nodos existentes NO se mueven: el usuario pudo haberlos acomodado a
 * mano y re-layout completo en cada expansión sería desorientante.
 */
function placeNewNodes(
  added: ErNode[],
  existing: Node[],
  edges: ErEdge[],
  anchorId: string | null
): { x: number; y: number }[] {
  const occupied: Rect[] = existing.map((n) => ({
    x: n.position.x,
    y: n.position.y,
    w: ER_NODE_WIDTH,
    h: estimateNodeHeight(n.data as ErNode),
  }));

  return added.map((er, index) => {
    // Nodo existente que conecta con el nuevo (prioriza el anchor = el nodo
    // cuya FK se clickeó) y dirección relativa de la relación.
    let anchor: Node | undefined;
    let direction: 1 | -1 = 1;
    const connecting = edges.filter((e) => {
      const fromKey = tableKey(e.from.schema, e.from.table);
      const toKey = tableKey(e.to.schema, e.to.table);
      return (
        (fromKey === er.id && existing.some((n) => n.id === toKey)) ||
        (toKey === er.id && existing.some((n) => n.id === fromKey))
      );
    });
    const chosen =
      connecting.find(
        (e) =>
          tableKey(e.from.schema, e.from.table) === anchorId ||
          tableKey(e.to.schema, e.to.table) === anchorId
      ) ?? connecting[0];
    if (chosen) {
      const fromKey = tableKey(chosen.from.schema, chosen.from.table);
      const toKey = tableKey(chosen.to.schema, chosen.to.table);
      if (fromKey === er.id) {
        direction = -1;
        anchor = existing.find((n) => n.id === toKey);
      } else {
        anchor = existing.find((n) => n.id === fromKey);
      }
    }
    if (!anchor && anchorId) anchor = existing.find((n) => n.id === anchorId);
    if (!anchor) anchor = existing[0];

    const h = estimateNodeHeight(er);
    const baseX = anchor ? anchor.position.x : 0;
    const baseY = anchor ? anchor.position.y : 0;
    const rect: Rect = {
      x: baseX + direction * (ER_NODE_WIDTH + EXPAND_GAP_X),
      y: baseY + index * (h + EXPAND_GAP_Y),
      w: ER_NODE_WIDTH,
      h,
    };
    let guard = 0;
    while (occupied.some((o) => rectsOverlap(o, rect, 12)) && guard < 200) {
      rect.y += EXPAND_GAP_Y + 12;
      guard += 1;
    }
    occupied.push(rect);
    return { x: rect.x, y: rect.y };
  });
}

function ErDiagramContent({ tab }: { tab: TableTab }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // Antes: useTheme() de next-themes, que nunca estuvo montado → resolvedTheme === undefined y el
  // diagrama usaba los colores del modo claro dentro de la app oscura (aristas gris zinc-600, PNG con
  // fondo blanco). Ahora salen del tema activo. Van como hex resueltos y no como var(--gdb-*) porque React
  // Flow los pone en atributos SVG de los marcadores y toPng necesita un color concreto.
  const { tokens: themeTokens } = useThemeTokens();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const flowRef = React.useRef<HTMLDivElement>(null);

  const isScoped = !!(tab.scopeTables && tab.scopeTables.length > 0);

  // Conjunto base de tablas: con scopeTables (diagrama de consulta) es ese
  // conjunto exacto; con el shortcut (tab.target) es SOLO la tabla raíz +
  // las tablas referenciadas por sus FKs (salientes, profundidad 1). Las
  // entrantes y el resto se agregan a mano (click en FK / botón "+").
  const base = React.useMemo(() => {
    if (!state.schema) {
      return { keys: [] as string[], refs: [] as TableRef[], truncated: false };
    }
    if (isScoped) {
      const refs = tab.scopeTables!;
      return {
        keys: refs.map((r) => tableKey(r.schema, r.table)),
        refs,
        truncated: false,
      };
    }
    const g = buildDirectErGraph(state.schema, tab.target);
    return {
      keys: g.nodes.map((n) => n.id),
      refs: g.nodes.map((n) => ({ schema: n.schema, table: n.table })),
      truncated: g.truncated,
    };
  }, [state.schema, tab.target, tab.scopeTables, isScoped]);

  const baseFingerprint = base.keys.join("|");
  const baseKeySet = React.useMemo(
    () => new Set(base.keys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseFingerprint]
  );

  // Tablas agregadas por expansión manual (click en FK / botón "+") y
  // tablas base quitadas manualmente (click en FK ya incluida).
  const [extraRefs, setExtraRefs] = React.useState<TableRef[]>([]);
  const [removedBaseKeys, setRemovedBaseKeys] = React.useState<string[]>([]);
  const forceRelayoutRef = React.useRef(true);
  const expandAnchorRef = React.useRef<string | null>(null);
  const [layoutVersion, setLayoutVersion] = React.useState(0);
  // El reset cuando cambia la base (otra tabla raíz, reconexión, otro scope)
  // va en un efecto declarado DESPUÉS del sync de nodos (ver abajo): así el
  // re-layout forzado ocurre sobre el grafo ya reseteado, no sobre la mezcla
  // transitoria base-nueva + extras-viejos. No puede hacerse durante el
  // render porque react-hooks/refs prohíbe escribir refs ahí.
  const lastFingerprintRef = React.useRef(baseFingerprint);

  const includedRefs = React.useMemo(() => {
    const removed = new Set(removedBaseKeys);
    const seen = new Set<string>();
    const refs: TableRef[] = [];
    for (const r of base.refs) {
      const k = tableKey(r.schema, r.table);
      if (removed.has(k) || seen.has(k)) continue;
      seen.add(k);
      refs.push(r);
    }
    for (const r of extraRefs) {
      const k = tableKey(r.schema, r.table);
      if (seen.has(k)) continue;
      seen.add(k);
      refs.push(r);
    }
    return refs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFingerprint, removedBaseKeys, extraRefs]);

  // Grafo derivado del conjunto incluido + flag por nodo de "tiene vecinos
  // aún no incluidos" (para mostrar el botón "+" en el header del nodo).
  const graph = React.useMemo(() => {
    if (!state.schema || includedRefs.length === 0) {
      return {
        nodes: [] as ErNode[],
        edges: [] as ErEdge[],
        includedKeys: new Set<string>(),
        moreByNode: new Map<string, boolean>(),
      };
    }
    const g = buildErGraphForTables(state.schema, includedRefs);
    const includedKeys = new Set(g.nodes.map((n) => n.id));
    const moreByNode = new Map<string, boolean>();
    for (const n of g.nodes) {
      const hasMore = getDirectNeighbors(state.schema, n).some(
        (r) => !includedKeys.has(tableKey(r.schema, r.table))
      );
      moreByNode.set(n.id, hasMore);
    }
    return { nodes: g.nodes, edges: g.edges, includedKeys, moreByNode };
  }, [state.schema, includedRefs]);

  const handleExpandFk = React.useCallback((fromKey: string, ref: TableRef) => {
    expandAnchorRef.current = fromKey;
    setExtraRefs((prev) =>
      prev.some((r) => tableKey(r.schema, r.table) === tableKey(ref.schema, ref.table))
        ? prev
        : [...prev, ref]
    );
  }, []);

  // Quitar una tabla con click en su FK ya incluida: si era tabla base pasa
  // a la lista de removidas; si era extra sale de extras. En ambos casos se
  // podan las extras que hayan quedado huérfanas (desconectadas de la base).
  const handleRemoveFk = React.useCallback(
    (ref: TableRef) => {
      if (!state.schema) return;
      const schema = state.schema;
      const key = tableKey(ref.schema, ref.table);
      if (baseKeySet.has(key)) {
        setRemovedBaseKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      }
      setExtraRefs((prev) => {
        const remaining = prev.filter(
          (r) => tableKey(r.schema, r.table) !== key
        );
        const anchors = base.refs.filter(
          (r) =>
            tableKey(r.schema, r.table) !== key &&
            !removedBaseKeys.includes(tableKey(r.schema, r.table))
        );
        return pruneOrphanExtras(schema, anchors, remaining);
      });
    },
    [state.schema, baseKeySet, base.refs, removedBaseKeys]
  );

  const handleExpandAll = React.useCallback(
    (fromKey: string, fromRef: TableRef) => {
      if (!state.schema) return;
      expandAnchorRef.current = fromKey;
      setExtraRefs((prev) => {
        const pending = new Set(prev.map((r) => tableKey(r.schema, r.table)));
        const additions = getDirectNeighbors(state.schema!, fromRef).filter(
          (r) =>
            !pending.has(tableKey(r.schema, r.table)) &&
            !baseKeySet.has(tableKey(r.schema, r.table))
        );
        if (additions.length === 0) {
          expandAnchorRef.current = null;
          return prev;
        }
        return [...prev, ...additions];
      });
    },
    [state.schema, baseKeySet]
  );

  // Nodos como estado (useNodesState + onNodesChange) para que se puedan
  // ARRASTRAR y reacomodar; las posiciones manuales se preservan entre
  // expansiones (solo se recolocan los nodos nuevos).
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  React.useEffect(() => {
    const toData = (er: ErNode): TableNodeData => ({
      ...er,
      includedKeys: graph.includedKeys,
      baseKeys: baseKeySet,
      rootKey: isScoped ? null : tableKey(tab.target.schema, tab.target.table),
      hasMoreNeighbors: graph.moreByNode.get(er.id) ?? false,
      onExpandFk: handleExpandFk,
      onRemoveFk: handleRemoveFk,
      onExpandAll: handleExpandAll,
    });
    setNodes((prev) => {
      if (forceRelayoutRef.current || prev.length === 0) {
        forceRelayoutRef.current = false;
        const { nodes: laidOut } = layoutErGraph(graph.nodes, graph.edges);
        return laidOut.map((er) => ({
          id: er.id,
          type: "table" as const,
          position: er.position ?? { x: 0, y: 0 },
          data: toData(er),
        }));
      }
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const kept: Node[] = [];
      const added: ErNode[] = [];
      for (const er of graph.nodes) {
        const existing = prevById.get(er.id);
        if (existing) kept.push({ ...existing, data: toData(er) });
        else added.push(er);
      }
      const positions = placeNewNodes(
        added,
        kept,
        graph.edges,
        expandAnchorRef.current
      );
      return [
        ...kept,
        ...added.map((er, i) => ({
          id: er.id,
          type: "table" as const,
          position: positions[i],
          data: toData(er),
        })),
      ];
    });
    expandAnchorRef.current = null;
  }, [graph, layoutVersion, handleExpandFk, handleRemoveFk, handleExpandAll, baseKeySet, isScoped, tab.target, setNodes]);

  // Reset de expansión + re-layout cuando cambia la base. Declarado después
  // del sync de nodos a propósito (ver comentario en lastFingerprintRef).
  React.useEffect(() => {
    if (lastFingerprintRef.current === baseFingerprint) return;
    lastFingerprintRef.current = baseFingerprint;
    setExtraRefs([]);
    setRemovedBaseKeys([]);
    forceRelayoutRef.current = true;
    setLayoutVersion((v) => v + 1);
  }, [baseFingerprint]);

  // fitView solo tras un layout completo (primer render, cambio de base o
  // botón "Reorganizar"); las expansiones manuales no mueven la cámara.
  const lastFitVersionRef = React.useRef(-1);
  React.useEffect(() => {
    if (nodes.length === 0) return;
    if (lastFitVersionRef.current === layoutVersion) return;
    lastFitVersionRef.current = layoutVersion;
    fitView({ padding: 0.2, duration: 200 });
  }, [nodes, layoutVersion, fitView]);

  // Edges: línea visible en ambos temas + label con el TIPO de relación
  // (1:1 si la FK es PK, N:1 en caso contrario) y el mapeo columna → columna.
  const rfEdges = React.useMemo<Edge[]>(() => {
    const stroke = themeTokens.fgdim;
    return graph.edges.map((e) => ({
      id: e.id,
      source: tableKey(e.from.schema, e.from.table),
      target: tableKey(e.to.schema, e.to.table),
      // Handles por columna: el edge sale de la fila de la columna FK y
      // llega a la fila de la columna referenciada.
      sourceHandle: `s-${e.from.column}`,
      targetHandle: `t-${e.to.column}`,
      type: "smoothstep",
      style: { stroke, strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 16,
        height: 16,
      },
      label: `${e.kind === "one-to-one" ? "1:1" : "N:1"} · ${e.from.column} → ${e.to.column}`,
      labelStyle: {
        fill: themeTokens.fg,
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: { fill: themeTokens.chrome, fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }));
  }, [graph.edges, themeTokens]);

  // Exportar WYSIWYG: se captura el canvas tal como se ve en pantalla
  // (pan/zoom y acomodo manual actuales, con el fondo punteado), filtrando el
  // chrome de la UI (minimapa, controles de zoom, attribution). Antes se
  // forzaba un fit-to-bounds que re-encuadraba todo y no reflejaba lo que el
  // usuario estaba viendo.
  const handleExport = React.useCallback(async () => {
    const el = flowRef.current;
    if (!el) return;

    const backgroundColor = themeTokens.chrome;
    const dataUrl = await toPng(el, {
      backgroundColor,
      pixelRatio: 2,
      filter: (domNode) => {
        const classList = (domNode as HTMLElement).classList;
        if (!classList) return true;
        return !(
          classList.contains("react-flow__minimap") ||
          classList.contains("react-flow__attribution") ||
          classList.contains("er-export-exclude")
        );
      },
    });

    const link = document.createElement("a");
    link.download = isScoped
      ? "er-consulta.png"
      : `er-${tab.target.schema}.${tab.target.table}.png`;
    link.href = dataUrl;
    link.click();
  }, [themeTokens.chrome, tab.target, isScoped]);

  // Reorganizar: re-layout dagre completo del conjunto actual (descarta las
  // posiciones manuales) + fitView.
  const handleRelayout = React.useCallback(() => {
    forceRelayoutRef.current = true;
    setLayoutVersion((v) => v + 1);
  }, []);

  const onNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = node.data as ErNode;
      dispatch({
        type: "OPEN_TABLE_TAB",
        payload: { schema: nodeData.schema, table: nodeData.table },
      });
    },
    [dispatch]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-card px-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">
            {isScoped
              ? "Tablas de la consulta"
              : `${tab.target.schema}.${tab.target.table}`}
          </span>
          <span className="text-muted-foreground">
            {graph.nodes.length} tablas · {graph.edges.length} relaciones
          </span>
          {base.truncated && (
            <span className="rounded bg-gdb-icokey/10 px-1.5 py-0.5 text-[10px] text-gdb-icokey">
              truncado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={handleRelayout}
            className="h-7 gap-1 text-xs"
          >
            <RefreshCwIcon className="size-3" />
            Reorganizar
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void handleExport()}
            className="h-7 gap-1 text-xs"
          >
            <DownloadIcon className="size-3" />
            Exportar PNG
          </Button>
        </div>
      </div>
      <div ref={flowRef} className={cn("relative flex-1", "react-flow-wrapper")}>
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          nodesConnectable={false}
          deleteKeyCode={null}
          attributionPosition="bottom-left"
        >
          {/* MiniMap navegable: click/drag lleva el viewport a esa sección
              (pannable). Cuadros en azul para distinguirlos del fondo. */}
          <MiniMap
            className="!bg-card"
            maskColor="rgb(0 0 0 / 20%)"
            nodeColor={themeTokens.accent}
            nodeStrokeColor={themeTokens.focus}
            pannable
          />
          <Background gap={16} size={1} />
        </ReactFlow>
        {/* Controles de zoom con etiqueta de texto (el <Controls /> default
            de xyflow son solo iconos +/− y no se entiende qué hacen).
            er-export-exclude: no salen en el PNG. */}
        <div className="er-export-exclude absolute bottom-3 left-3 z-10 flex flex-col gap-1">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={() => zoomIn({ duration: 150 })}
          >
            <ZoomInIcon className="size-3.5" />
            Acercar
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={() => zoomOut({ duration: 150 })}
          >
            <ZoomOutIcon className="size-3.5" />
            Alejar
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={() => fitView({ padding: 0.2, duration: 200 })}
          >
            <MaximizeIcon className="size-3.5" />
            Ajustar vista
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErDiagramTab({ tab }: { tab: TableTab }) {
  return (
    <ReactFlowProvider>
      <ErDiagramContent tab={tab} />
    </ReactFlowProvider>
  );
}
