import type {
  BatchOperation,
  ConnectionProfile,
  ExplainNode,
  QueryResult,
  SchemaNode,
} from "@/lib/types";

export type DriverConfig = ConnectionProfile;

export interface BatchEditInput {
  schema?: string;
  table: string;
  pkColumn: string;
  operations: BatchOperation[];
}

export interface DatabaseDriver {
  testConnection(): Promise<void>;
  listDatabases(): Promise<string[]>;
  getSchema(): Promise<SchemaNode[]>;
  /**
   * `tx`, cuando se pasa, es el handle opaco devuelto por `beginTransaction`:
   * la sentencia se ejecuta sobre esa misma conexión en vez de tomar una
   * nueva del pool, para que varias queries compartan una transacción.
   */
  executeQuery(sql: string, tx?: unknown): Promise<QueryResult>;
  executeBatch(input: BatchEditInput): Promise<{ affectedRows: number }>;
  getTableDdl(schema: string, table: string): Promise<string>;
  /**
   * Devuelve el DDL de una función o procedimiento almacenado.
   * Implementar en cada motor para mantener la visualización del schema
   * consistente cuando se agreguen nuevos tipos de base de datos.
   */
  getRoutineDdl(schema: string, name: string, type: "function" | "procedure"): Promise<string>;
  /** Devuelve el DDL de un trigger. */
  getTriggerDdl(schema: string, name: string): Promise<string>;
  /** Cancela la query en ejecución en este driver, si la hay. No-op si no hay ninguna corriendo. */
  cancelQuery(): Promise<void>;
  /** Abre una transacción manual y devuelve un handle opaco para pasar a executeQuery/commit/rollback. */
  beginTransaction(): Promise<unknown>;
  commitTransaction(tx: unknown): Promise<void>;
  rollbackTransaction(tx: unknown): Promise<void>;
  /** Ejecuta EXPLAIN sobre la sentencia y devuelve el plan normalizado como árbol. No modifica datos. */
  explainQuery(sql: string): Promise<ExplainNode>;
  close(): Promise<void>;
}
