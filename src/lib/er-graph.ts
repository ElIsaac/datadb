import dagre from "dagre";
import type { SchemaNode, ColumnMeta } from "@/lib/types";

const MAX_TABLES = 80;
export const ER_NODE_WIDTH = 240;
const NODE_ROW_HEIGHT = 20;
const NODE_HEADER_HEIGHT = 36;

export interface ErNode extends Record<string, unknown> {
  id: string;
  schema: string;
  table: string;
  columns: ColumnMeta[];
  position?: { x: number; y: number };
}

/**
 * Cardinalidad aproximada de la relación. Solo contamos con `isPrimaryKey`
 * como proxy de unicidad (el schema no expone índices UNIQUE): si la columna
 * FK es PK la relación es 1:1; en cualquier otro caso es N:1 (muchos rows de
 * la tabla con FK apuntan a un row de la tabla referenciada).
 */
export type ErRelationKind = "one-to-one" | "many-to-one";

export interface ErEdge {
  id: string;
  from: { schema: string; table: string; column: string };
  to: { schema: string; table: string; column: string };
  kind: ErRelationKind;
}

/** Alto estimado de la tarjeta de una tabla (header + filas + padding py-1). */
export function estimateNodeHeight(node: Pick<ErNode, "columns">): number {
  return NODE_HEADER_HEIGHT + node.columns.length * NODE_ROW_HEIGHT + 8;
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function buildErGraph(
  schemaNodes: SchemaNode[],
  root: { schema: string; table: string }
): { nodes: ErNode[]; edges: ErEdge[]; truncated: boolean } {
  const nodes = new Map<string, ErNode>();
  const edges = new Map<string, ErEdge>();
  const queue: { schema: string; table: string }[] = [];
  let truncated = false;

  const rootNode = schemaNodes.find((s) => s.name === root.schema);
  const rootTable = rootNode?.tables.find((t) => t.name === root.table);
  if (!rootTable) {
    return { nodes: [], edges: [], truncated: false };
  }

  nodes.set(tableKey(root.schema, root.table), {
    id: tableKey(root.schema, root.table),
    schema: root.schema,
    table: root.table,
    columns: rootTable.columns,
  });
  queue.push(root);

  function enqueue(schema: string, table: string) {
    const key = tableKey(schema, table);
    if (nodes.size >= MAX_TABLES && !nodes.has(key)) {
      truncated = true;
      return;
    }
    if (!nodes.has(key)) {
      const schemaNode = schemaNodes.find((s) => s.name === schema);
      const tableMeta = schemaNode?.tables.find((t) => t.name === table);
      if (!tableMeta) return;
      nodes.set(key, {
        id: key,
        schema,
        table,
        columns: tableMeta.columns,
      });
      queue.push({ schema, table });
    }
  }

  function addEdge(
    fromSchema: string,
    fromTable: string,
    fromColumn: string,
    toSchema: string,
    toTable: string,
    toColumn: string,
    fkColumn: ColumnMeta
  ) {
    const id = `${fromSchema}.${fromTable}.${fromColumn}->${toSchema}.${toTable}.${toColumn}`;
    if (edges.has(id)) return;
    edges.set(id, {
      id,
      from: { schema: fromSchema, table: fromTable, column: fromColumn },
      to: { schema: toSchema, table: toTable, column: toColumn },
      kind: fkColumn.isPrimaryKey ? "one-to-one" : "many-to-one",
    });
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = tableKey(current.schema, current.table);
    const currentNode = nodes.get(currentKey);
    if (!currentNode) continue;

    // Relaciones salientes: columnas FK de la tabla actual.
    for (const column of currentNode.columns) {
      if (!column.fk) continue;
      const targetSchema = column.fk.schema || current.schema;
      enqueue(targetSchema, column.fk.table);
      addEdge(
        current.schema,
        current.table,
        column.name,
        targetSchema,
        column.fk.table,
        column.fk.column,
        column
      );
    }

    // Relaciones entrantes: otras tablas cuyas FK apuntan a la tabla actual.
    for (const schemaNode of schemaNodes) {
      for (const table of schemaNode.tables) {
        for (const column of table.columns) {
          if (!column.fk) continue;
          const fkSchema = column.fk.schema || schemaNode.name;
          if (
            fkSchema === current.schema &&
            column.fk.table === current.table
          ) {
            enqueue(schemaNode.name, table.name);
            addEdge(
              schemaNode.name,
              table.name,
              column.name,
              current.schema,
              current.table,
              column.fk.column,
              column
            );
          }
        }
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    truncated,
  };
}

/**
 * Construye el grafo ER restringido exactamente al conjunto de tablas dado
 * (p. ej. las referenciadas en la consulta con foco), sin expandir por FK
 * hacia tablas relacionadas. Solo se incluyen las relaciones (edges) cuyos
 * dos extremos pertenecen al conjunto.
 */
export function buildErGraphForTables(
  schemaNodes: SchemaNode[],
  tables: { schema: string; table: string }[]
): { nodes: ErNode[]; edges: ErEdge[]; truncated: boolean } {
  const nodes = new Map<string, ErNode>();
  const edges = new Map<string, ErEdge>();

  for (const ref of tables) {
    const key = tableKey(ref.schema, ref.table);
    if (nodes.has(key)) continue;
    const schemaNode = schemaNodes.find((s) => s.name === ref.schema);
    const tableMeta = schemaNode?.tables.find((t) => t.name === ref.table);
    if (!tableMeta) continue;
    nodes.set(key, {
      id: key,
      schema: ref.schema,
      table: ref.table,
      columns: tableMeta.columns,
    });
  }

  function addEdge(
    fromSchema: string,
    fromTable: string,
    fromColumn: string,
    toSchema: string,
    toTable: string,
    toColumn: string,
    fkColumn: ColumnMeta
  ) {
    const id = `${fromSchema}.${fromTable}.${fromColumn}->${toSchema}.${toTable}.${toColumn}`;
    if (edges.has(id)) return;
    edges.set(id, {
      id,
      from: { schema: fromSchema, table: fromTable, column: fromColumn },
      to: { schema: toSchema, table: toTable, column: toColumn },
      kind: fkColumn.isPrimaryKey ? "one-to-one" : "many-to-one",
    });
  }

  for (const node of nodes.values()) {
    for (const column of node.columns) {
      if (!column.fk) continue;
      const targetSchema = column.fk.schema || node.schema;
      const targetKey = tableKey(targetSchema, column.fk.table);
      if (!nodes.has(targetKey)) continue;
      addEdge(
        node.schema,
        node.table,
        column.name,
        targetSchema,
        column.fk.table,
        column.fk.column,
        column
      );
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    truncated: false,
  };
}

export function layoutErGraph(
  nodes: ErNode[],
  edges: ErEdge[]
): { nodes: ErNode[]; edges: ErEdge[] } {
  const graph = new dagre.graphlib.Graph<Record<string, unknown>>();
  // Spacing amplio a propósito: el primer render debe quedar aireado y con
  // los menos cruces posibles (dagre minimiza cruces dentro de cada rank).
  // ranksep alto además para que el label del edge ("N:1 · col → col") quepa
  // en el hueco entre columnas de nodos sin empalmarse con las tarjetas.
  graph.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 210 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: ER_NODE_WIDTH,
      height: estimateNodeHeight(node),
    });
  }

  for (const edge of edges) {
    graph.setEdge(
      tableKey(edge.from.schema, edge.from.table),
      tableKey(edge.to.schema, edge.to.table)
    );
  }

  dagre.layout(graph);

  const positioned = nodes.map((node) => {
    const graphNode = graph.node(node.id);
    return {
      ...node,
      position: {
        x: graphNode.x - graphNode.width / 2,
        y: graphNode.y - graphNode.height / 2,
      },
    };
  });

  return { nodes: positioned, edges };
}

/**
 * Vecinos FK SALIENTES de una tabla: únicamente las tablas referenciadas por
 * sus columnas FK. Es el conjunto inicial del diagrama interactivo (la tabla
 * raíz + estas), porque corresponde a lo que el usuario ve como "sus FKs" en
 * el DDL. Las tablas entrantes (cuyas FKs apuntan a esta) NO se incluyen de
 * entrada: se agregan bajo demanda con el botón "+" del nodo.
 */
export function getOutgoingNeighbors(
  schemaNodes: SchemaNode[],
  ref: { schema: string; table: string }
): { schema: string; table: string }[] {
  const result = new Map<string, { schema: string; table: string }>();
  const schemaNode = schemaNodes.find((s) => s.name === ref.schema);
  const tableMeta = schemaNode?.tables.find((t) => t.name === ref.table);
  for (const column of tableMeta?.columns ?? []) {
    if (!column.fk) continue;
    const key = tableKey(column.fk.schema || ref.schema, column.fk.table);
    if (key === tableKey(ref.schema, ref.table) || result.has(key)) continue;
    result.set(key, {
      schema: column.fk.schema || ref.schema,
      table: column.fk.table,
    });
  }
  return Array.from(result.values());
}

/**
 * Vecinos FK directos (profundidad 1) de una tabla, en ambas direcciones:
 * tablas referenciadas por sus FKs (salientes) + tablas cuyas FKs la
 * referencian (entrantes). Sin recursión: es la unidad de expansión del
 * diagrama interactivo (click en una FK agrega ese vecino).
 */
export function getDirectNeighbors(
  schemaNodes: SchemaNode[],
  ref: { schema: string; table: string }
): { schema: string; table: string }[] {
  const result = new Map<string, { schema: string; table: string }>();
  const selfKey = tableKey(ref.schema, ref.table);
  const add = (schema: string, table: string) => {
    const key = tableKey(schema, table);
    if (key === selfKey || result.has(key)) return;
    result.set(key, { schema, table });
  };

  // Salientes.
  for (const n of getOutgoingNeighbors(schemaNodes, ref)) {
    add(n.schema, n.table);
  }

  // Entrantes: tablas cuyas FKs apuntan a esta tabla.
  for (const sn of schemaNodes) {
    for (const table of sn.tables) {
      for (const column of table.columns) {
        if (!column.fk) continue;
        const fkSchema = column.fk.schema || sn.name;
        if (fkSchema === ref.schema && column.fk.table === ref.table) {
          add(sn.name, table.name);
        }
      }
    }
  }

  return Array.from(result.values());
}

/**
 * Grafo inicial del diagrama interactivo: SOLO la tabla raíz + las tablas
 * referenciadas por sus FKs (salientes, profundidad 1). A diferencia de
 * `buildErGraph` (que expande todo el componente conexo recursivamente),
 * aquí el usuario decide luego qué tablas agregar: click en cada FK para la
 * referenciada, o botón "+" del nodo para sus vecinos restantes (incluidas
 * las entrantes). Si la raíz referencia más de MAX_TABLES-1 tablas, se corta
 * y se marca `truncated`.
 */
export function buildDirectErGraph(
  schemaNodes: SchemaNode[],
  root: { schema: string; table: string }
): { nodes: ErNode[]; edges: ErEdge[]; truncated: boolean } {
  const rootNode = schemaNodes.find((s) => s.name === root.schema);
  const rootTable = rootNode?.tables.find((t) => t.name === root.table);
  if (!rootTable) {
    return { nodes: [], edges: [], truncated: false };
  }

  const neighbors = getOutgoingNeighbors(schemaNodes, root);
  let truncated = false;
  let limited = neighbors;
  if (neighbors.length > MAX_TABLES - 1) {
    limited = neighbors.slice(0, MAX_TABLES - 1);
    truncated = true;
  }

  const graph = buildErGraphForTables(schemaNodes, [root, ...limited]);
  return { ...graph, truncated };
}
